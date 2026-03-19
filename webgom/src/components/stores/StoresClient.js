"use client";

import { useState, useMemo } from 'react';
import Link from 'next/link';

const STORES = [
  {
    id: 1,
    name: 'Showroom Hà Nội',
    city: 'Hà Nội',
    address: 'Số 15 Lý Quốc Sư, Quận Hoàn Kiếm, Hà Nội',
    phone: '(+84) 24 3828 5555',
    hours: '08:00 – 21:00 (Hằng ngày)',
    tag: 'Showroom chính',
    mapEmbed: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3724.095607743636!2d105.84846077599747!3d21.028779088004698!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3135ab9b734b3969%3A0x74855b5d2e52e1b4!2zTMO9IFF14buRYyBT01IsIEhvw6BuIEtp4bq_bSwgSMOgIE7hu5Np!5e0!3m2!1sen!2svn!4v1700000000000!5m2!1sen!2svn',
    mapLink: 'https://maps.google.com/?q=Lý+Quốc+Sư,+Hoàn+Kiếm,+Hà+Nội',
    lat: 21.0288,
    lng: 105.8485,
  },
  {
    id: 2,
    name: 'Xưởng Gốm Bát Tràng',
    city: 'Hà Nội',
    address: 'Xóm 3, Làng cổ Bát Tràng, Gia Lâm, Hà Nội',
    phone: '(+84) 24 3874 1234',
    hours: '07:30 – 18:30 (Hằng ngày)',
    tag: 'Xưởng sản xuất',
    mapEmbed: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3723.5!2d105.9029!3d21.0333!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3135a961b9c0f7fb%3A0x5376f5b1e4e8b72e!2zQsOhdCBUcsOgbmcsIEdpYSBMw6JtLCBIw6AgTuG7mWk!5e0!3m2!1sen!2svn!4v1700000000001!5m2!1sen!2svn',
    mapLink: 'https://maps.google.com/?q=Bát+Tràng,+Gia+Lâm,+Hà+Nội',
    lat: 21.033,
    lng: 105.903,
  },
  {
    id: 3,
    name: 'Chi Nhánh TP. HCM',
    city: 'TP. Hồ Chí Minh',
    address: '88 Đồng Khởi, Quận 1, TP. Hồ Chí Minh',
    phone: '(+84) 28 3823 4567',
    hours: '09:00 – 22:00 (Hằng ngày)',
    tag: 'Chi nhánh',
    mapEmbed: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3919.4553735506!2d106.70131!3d10.77873!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x31752f4670702e31%3A0xa5777fb3a5bb9f8b!2zxJDhu5NuZyBLaOG7n2ksIFF14bqtbiAxLCBUaMOgbmggcGjhu5EgSOG7kyBDaMOtIE1pbmg!5e0!3m2!1sen!2svn!4v1700000000002!5m2!1sen!2svn',
    mapLink: 'https://maps.google.com/?q=88+Đồng+Khởi,+Quận+1,+TP+HCM',
    lat: 10.7787,
    lng: 106.7013,
  },
  {
    id: 4,
    name: 'Cửa Hàng Đà Nẵng',
    city: 'Đà Nẵng',
    address: '150 Trần Phú, Quận Hải Châu, Đà Nẵng',
    phone: '(+84) 23 6382 1111',
    hours: '08:30 – 20:30 (Hằng ngày)',
    tag: 'Cửa hàng',
    mapEmbed: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3834.2!2d108.2208!3d16.0678!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x314219c792252a13%3A0xd0b1aaec03dba0ef!2zVHLhuqduIFBow7osIEjhuqNpIENow6J1LCDEkMOgIE7hurVuZw!5e0!3m2!1sen!2svn!4v1700000000003!5m2!1sen!2svn',
    mapLink: 'https://maps.google.com/?q=150+Trần+Phú,+Hải+Châu,+Đà+Nẵng',
    lat: 16.0678,
    lng: 108.2208,
  },
];

export default function StoresClient() {
  const [activeId, setActiveId] = useState(1);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return STORES;
    const q = search.trim().toLowerCase();
    return STORES.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.city.toLowerCase().includes(q) ||
      s.address.toLowerCase().includes(q)
    );
  }, [search]);

  const activeStore = STORES.find(s => s.id === activeId) || STORES[0];

  return (
    <div className="stores-page">
      {/* Sidebar */}
      <aside className="stores-sidebar">
        {/* Sidebar Header */}
        <div className="stores-sidebar-header">
          <h2 className="stores-sidebar-title">Hệ Thống Cửa Hàng</h2>
          <div className="stores-search-wrap">
            <span className="material-symbols-outlined stores-search-icon">location_on</span>
            <input
              className="stores-search-input"
              type="text"
              placeholder="Tìm theo thành phố..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="stores-search-clear" onClick={() => setSearch('')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            )}
          </div>
        </div>

        {/* Store List */}
        <div className="stores-list">
          {filtered.length === 0 ? (
            <div className="stores-empty">
              <span className="material-symbols-outlined">search_off</span>
              <p>Không tìm thấy cửa hàng nào.</p>
            </div>
          ) : filtered.map(store => (
            <div
              key={store.id}
              className={`stores-card${activeId === store.id ? ' stores-card--active' : ''}`}
              onClick={() => setActiveId(store.id)}
            >
              <div className="stores-card-top">
                <h3 className="stores-card-name">{store.name}</h3>
                <span className="stores-card-tag">{store.tag}</span>
              </div>
              <div className="stores-card-info">
                <div className="stores-card-row">
                  <span className="material-symbols-outlined">map</span>
                  <p>{store.address}</p>
                </div>
                <div className="stores-card-row">
                  <span className="material-symbols-outlined">call</span>
                  <a href={`tel:${store.phone}`} onClick={e => e.stopPropagation()}>{store.phone}</a>
                </div>
                <div className="stores-card-row">
                  <span className="material-symbols-outlined">schedule</span>
                  <p>{store.hours}</p>
                </div>
              </div>
              <div className="stores-card-actions">
                <a
                  href={store.mapLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="stores-card-btn"
                  onClick={e => e.stopPropagation()}
                >
                  <span className="material-symbols-outlined">directions</span>
                  Chỉ đường
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Hotline Footer */}
        <div className="stores-hotline">
          <p className="stores-hotline-label">Hỗ trợ khách hàng</p>
          <p className="stores-hotline-number">
            <span className="material-symbols-outlined">headset_mic</span>
            Hotline: 1800 6688
          </p>
        </div>
      </aside>

      {/* Map Section */}
      <section className="stores-map">
        {/* Map iframe */}
        <iframe
          key={activeStore.id}
          className="stores-map-iframe"
          src={activeStore.mapEmbed}
          allowFullScreen=""
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title={`Bản đồ ${activeStore.name}`}
        />

        {/* Active store info overlay */}
        <div className="stores-map-pin">
          <div className="stores-map-popup">
            <p className="stores-map-popup-label">Bạn đang xem</p>
            <p className="stores-map-popup-name">{activeStore.name}</p>
          </div>
          <span className="material-symbols-outlined stores-map-pin-icon">location_on</span>
        </div>

        {/* Map controls overlay */}
        <div className="stores-map-controls">
          <a
            href={activeStore.mapLink}
            target="_blank"
            rel="noopener noreferrer"
            className="stores-map-ctrl stores-map-ctrl--location"
            title="Chỉ đường"
          >
            <span className="material-symbols-outlined">my_location</span>
          </a>
        </div>

        {/* Store quick info overlay (bottom) */}
        <div className="stores-map-info-bar">
          <div className="stores-map-info-left">
            <span className="material-symbols-outlined stores-map-info-icon">storefront</span>
            <div>
              <p className="stores-map-info-name">{activeStore.name}</p>
              <p className="stores-map-info-addr">{activeStore.address}</p>
            </div>
          </div>
          <div className="stores-map-info-right">
            <span className="material-symbols-outlined">schedule</span>
            <span>{activeStore.hours}</span>
          </div>
        </div>

        {/* Gradient vignette */}
        <div className="stores-map-vignette-top" />
        <div className="stores-map-vignette-bottom" />
      </section>

      <style>{`
        /* ─── Page layout ─── */
        .stores-page {
          display: flex;
          height: calc(100vh - 88px);
          overflow: hidden;
          background: #F9F5F0;
          font-family: 'Noto Serif', serif;
        }

        /* ─── Sidebar ─── */
        .stores-sidebar {
          width: 400px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          background: #F9F5F0;
          border-right: 1px solid rgba(197,160,101,0.2);
          box-shadow: 4px 0 20px rgba(27,54,93,0.08);
          z-index: 10;
          height: 100%;
          overflow: hidden;
        }

        /* Sidebar header */
        .stores-sidebar-header {
          padding: 1.5rem;
          border-bottom: 1px solid rgba(197,160,101,0.15);
          flex-shrink: 0;
        }
        .stores-sidebar-title {
          font-family: 'Playfair Display', serif;
          font-size: 1.8rem; font-weight: 700;
          color: #1B365D; margin: 0 0 1rem;
        }
        .stores-search-wrap {
          position: relative;
        }
        .stores-search-icon {
          position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%);
          color: #C5A065; font-size: 1.1rem;
        }
        .stores-search-input {
          width: 100%; padding: 0.75rem 2.5rem 0.75rem 2.5rem;
          background: white; border: 1px solid rgba(197,160,101,0.35);
          border-radius: 2px; font-size: 0.9rem; color: #1B365D;
          font-family: 'Noto Serif', serif; outline: none;
          box-shadow: 0 1px 4px rgba(27,54,93,0.06);
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .stores-search-input:focus {
          border-color: #1B365D;
          box-shadow: 0 0 0 2px rgba(27,54,93,0.1);
        }
        .stores-search-input::placeholder { color: #94a3b8; }
        .stores-search-clear {
          position: absolute; right: 0.6rem; top: 50%; transform: translateY(-50%);
          color: #94a3b8; background: none; border: none; cursor: pointer; padding: 2px;
        }
        .stores-search-clear .material-symbols-outlined { font-size: 1rem; }

        /* Store list */
        .stores-list {
          flex: 1; overflow-y: auto; padding: 1.25rem;
          display: flex; flex-direction: column; gap: 0.85rem;
        }
        .stores-list::-webkit-scrollbar { width: 4px; }
        .stores-list::-webkit-scrollbar-track { background: #F9F5F0; }
        .stores-list::-webkit-scrollbar-thumb { background: #C5A065; border-radius: 2px; }

        .stores-empty {
          display: flex; flex-direction: column; align-items: center;
          gap: 0.5rem; padding: 3rem; color: #94a3b8;
          font-style: italic; font-size: 0.9rem;
        }
        .stores-empty .material-symbols-outlined { font-size: 2.5rem; }

        /* Store card */
        .stores-card {
          background: white; cursor: pointer;
          border-left: 4px solid rgba(197,160,101,0.25);
          box-shadow: 0 1px 4px rgba(27,54,93,0.06);
          padding: 1.1rem 1.1rem 0.85rem;
          transition: all 0.25s;
        }
        .stores-card:hover {
          border-left-color: #1B365D;
          box-shadow: 0 4px 16px rgba(27,54,93,0.12);
          transform: translateX(2px);
        }
        .stores-card--active {
          border-left-color: #1B365D;
          box-shadow: 0 4px 16px rgba(27,54,93,0.14);
        }
        .stores-card-top {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 0.5rem; margin-bottom: 0.75rem;
        }
        .stores-card-name {
          font-family: 'Playfair Display', serif;
          font-size: 1.1rem; font-weight: 700; color: #1B365D; margin: 0;
          transition: color 0.2s; line-height: 1.3;
        }
        .stores-card:hover .stores-card-name,
        .stores-card--active .stores-card-name { color: #C5A065; }
        .stores-card-tag {
          font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase; color: #1B365D;
          background: rgba(197,160,101,0.15); padding: 0.2rem 0.55rem;
          border: 1px solid rgba(197,160,101,0.3); white-space: nowrap; flex-shrink: 0;
        }
        .stores-card--active .stores-card-tag {
          background: #1B365D; color: white; border-color: #1B365D;
        }
        .stores-card-info { display: flex; flex-direction: column; gap: 0.4rem; }
        .stores-card-row {
          display: flex; align-items: flex-start; gap: 0.5rem;
          font-size: 0.85rem; color: #64748b; line-height: 1.5;
        }
        .stores-card-row .material-symbols-outlined {
          font-size: 0.95rem; color: #C5A065; flex-shrink: 0; margin-top: 2px;
        }
        .stores-card-row a { color: #64748b; text-decoration: none; }
        .stores-card-row a:hover { color: #1B365D; text-decoration: underline; }
        .stores-card-actions {
          display: flex; gap: 0.5rem; margin-top: 0.85rem;
          padding-top: 0.75rem; border-top: 1px solid rgba(197,160,101,0.12);
        }
        .stores-card-btn {
          display: inline-flex; align-items: center; gap: 0.3rem;
          font-size: 0.78rem; font-weight: 600; color: #1B365D;
          text-transform: uppercase; letter-spacing: 0.06em;
          padding: 0.35rem 0.85rem; border: 1px solid rgba(27,54,93,0.25);
          transition: all 0.2s; text-decoration: none;
        }
        .stores-card-btn:hover { background: #1B365D; color: white; border-color: #1B365D; }
        .stores-card-btn .material-symbols-outlined { font-size: 0.9rem; }

        /* Hotline */
        .stores-hotline {
          padding: 1rem 1.5rem; background: #1B365D; text-align: center; flex-shrink: 0;
        }
        .stores-hotline-label {
          font-size: 0.65rem; font-weight: 700; letter-spacing: 0.2em;
          text-transform: uppercase; color: rgba(197,160,101,0.8); margin: 0;
        }
        .stores-hotline-number {
          font-family: 'Playfair Display', serif;
          font-size: 1.05rem; color: white; margin: 0.25rem 0 0;
          display: flex; align-items: center; justify-content: center; gap: 0.4rem;
        }
        .stores-hotline-number .material-symbols-outlined { font-size: 1rem; color: #C5A065; }

        /* ─── Map section ─── */
        .stores-map {
          flex: 1; position: relative; overflow: hidden; background: #e2ddd6;
        }
        .stores-map-iframe {
          position: absolute; inset: 0; width: 100%; height: 100%;
          border: none; filter: saturate(0.85) contrast(1.05);
          transition: opacity 0.3s;
        }

        /* Active store popup */
        .stores-map-pin {
          position: absolute; top: 28%; left: 42%;
          z-index: 20; display: flex; flex-direction: column; align-items: center;
          pointer-events: none; animation: mapPinBounce 2s ease-in-out infinite;
        }
        @keyframes mapPinBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .stores-map-popup {
          background: white; padding: 0.6rem 1rem; margin-bottom: -2px;
          box-shadow: 0 4px 20px rgba(27,54,93,0.2);
          border: 4px double #C5A065; white-space: nowrap;
        }
        .stores-map-popup-label {
          font-size: 0.6rem; color: #C5A065; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.15em; margin: 0;
        }
        .stores-map-popup-name {
          font-family: 'Playfair Display', serif; font-size: 0.9rem;
          font-weight: 700; color: #1B365D; margin: 0;
        }
        .stores-map-pin-icon { font-size: 3.5rem; color: #1B365D; filter: drop-shadow(0 4px 8px rgba(27,54,93,0.4)); }

        /* Controls */
        .stores-map-controls {
          position: absolute; bottom: 5.5rem; right: 1.25rem;
          z-index: 20; display: flex; flex-direction: column; gap: 0.5rem;
        }
        .stores-map-ctrl {
          width: 44px; height: 44px; background: white; color: #1B365D;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 2px 8px rgba(27,54,93,0.15);
          border: none; cursor: pointer; transition: all 0.2s; border-radius: 2px;
          text-decoration: none;
        }
        .stores-map-ctrl:hover { background: #C5A065; color: white; }
        .stores-map-ctrl--location { background: #1B365D; color: white; }
        .stores-map-ctrl--location:hover { background: #C5A065; }
        .stores-map-ctrl .material-symbols-outlined { font-size: 1.3rem; }

        /* Bottom info bar */
        .stores-map-info-bar {
          position: absolute; bottom: 0; left: 0; right: 0; z-index: 20;
          background: rgba(27,54,93,0.92); backdrop-filter: blur(8px);
          padding: 0.9rem 1.5rem;
          display: flex; align-items: center; justify-content: space-between;
          gap: 1rem; flex-wrap: wrap;
        }
        .stores-map-info-left {
          display: flex; align-items: flex-start; gap: 0.75rem;
        }
        .stores-map-info-icon { color: #C5A065; font-size: 1.5rem; flex-shrink: 0; margin-top: 2px; }
        .stores-map-info-name {
          font-family: 'Playfair Display', serif;
          font-size: 1rem; font-weight: 700; color: white; margin: 0;
        }
        .stores-map-info-addr { font-size: 0.8rem; color: rgba(249,245,240,0.75); margin: 0.15rem 0 0; }
        .stores-map-info-right {
          display: flex; align-items: center; gap: 0.4rem;
          font-size: 0.82rem; color: rgba(249,245,240,0.85); flex-shrink: 0;
        }
        .stores-map-info-right .material-symbols-outlined { font-size: 1rem; color: #C5A065; }

        /* Vignette */
        .stores-map-vignette-top {
          position: absolute; top: 0; left: 0; right: 0; height: 48px;
          background: linear-gradient(to bottom, rgba(249,245,240,0.4), transparent);
          pointer-events: none; z-index: 5;
        }
        .stores-map-vignette-bottom {
          position: absolute; bottom: 56px; left: 0; right: 0; height: 40px;
          background: linear-gradient(to top, rgba(27,54,93,0.15), transparent);
          pointer-events: none; z-index: 5;
        }

        /* ─── Responsive ─── */
        @media (max-width: 900px) {
          .stores-page { flex-direction: column; height: auto; }
          .stores-sidebar { width: 100%; height: auto; max-height: 55vh; }
          .stores-map { height: 50vh; }
          .stores-map-pin { display: none; }
        }
      `}</style>
    </div>
  );
}
