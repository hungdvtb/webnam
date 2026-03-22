"use client";

import { useMemo, useState } from 'react';

const EMPTY_TITLE = 'Hệ thống cửa hàng đang cập nhật';
const EMPTY_DESCRIPTION = 'Thông tin showroom và chi nhánh sẽ hiển thị tại đây ngay sau khi được cập nhật trong Cài đặt web.';

const asText = (value) => String(value || '').trim();

const buildPhoneLink = (value) => `tel:${asText(value).replace(/[^\d+]/g, '')}`;
const buildMailLink = (value) => `mailto:${asText(value)}`;

const buildMapQuery = (store) => [store.name, store.address, store.city].filter(Boolean).join(', ');

const buildMapEmbedUrl = (store) => {
  const query = buildMapQuery(store);
  return query ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed` : '';
};

const buildMapExternalUrl = (store) => {
  if (store.googleMapsLink) {
    return store.googleMapsLink;
  }

  const query = buildMapQuery(store);
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
};

const normalizeStores = (stores) => {
  if (!Array.isArray(stores)) {
    return [];
  }

  return stores
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const normalized = {
        id: asText(item.id) || `store-${index + 1}`,
        name: asText(item.name),
        city: asText(item.city),
        tag: asText(item.tag),
        address: asText(item.address),
        phone: asText(item.phone),
        hotline: asText(item.hotline),
        email: asText(item.email),
        openingHours: asText(item.opening_hours || item.hours),
        googleMapsLink: asText(item.google_maps_link || item.mapLink),
        imageUrl: asText(item.image_url || item.imageUrl),
        note: asText(item.note),
        isActive: item.is_active === undefined ? true : Boolean(item.is_active),
        order: Number(item.order ?? item.sort_order ?? (index + 1)) || (index + 1),
      };

      return {
        ...normalized,
        mapEmbedUrl: buildMapEmbedUrl(normalized),
        mapExternalUrl: buildMapExternalUrl(normalized),
      };
    })
    .filter((store) => store.isActive && (store.name || store.address))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'));
};

export default function StoresClient({ stores = [] }) {
  const normalizedStores = useMemo(() => normalizeStores(stores), [stores]);
  const [activeId, setActiveId] = useState('');
  const [search, setSearch] = useState('');

  const filteredStores = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return normalizedStores;
    }

    return normalizedStores.filter((store) =>
      [store.name, store.city, store.address, store.tag, store.phone, store.hotline, store.email]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(keyword))
    );
  }, [normalizedStores, search]);

  const resolvedActiveId = useMemo(() => {
    if (!filteredStores.length) {
      return '';
    }

    return filteredStores.some((store) => store.id === activeId) ? activeId : filteredStores[0].id;
  }, [filteredStores, activeId]);

  const activeStore = useMemo(
    () => filteredStores.find((store) => store.id === resolvedActiveId) || filteredStores[0] || null,
    [filteredStores, resolvedActiveId]
  );

  const supportHotline = useMemo(
    () => normalizedStores.find((store) => store.hotline)?.hotline || normalizedStores.find((store) => store.phone)?.phone || '',
    [normalizedStores]
  );

  const hasConfiguredStores = normalizedStores.length > 0;
  const hasSearchResults = filteredStores.length > 0;
  return (
    <div className="stores-page">
      <aside className="stores-sidebar">
        <div className="stores-sidebar-header">
          <p className="stores-sidebar-eyebrow">SHOWROOM & CHI NHÁNH</p>
          <h1 className="stores-sidebar-title">Hệ thống cửa hàng</h1>

          <div className="stores-search-wrap">
            <span className="material-symbols-outlined stores-search-icon">search</span>
            <input
              className="stores-search-input"
              type="text"
              placeholder={hasConfiguredStores ? 'Tìm theo tên, thành phố, địa chỉ...' : 'Chưa có dữ liệu cửa hàng'}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={!hasConfiguredStores}
            />
            {search ? (
              <button
                type="button"
                className="stores-search-clear"
                onClick={() => setSearch('')}
                aria-label="Xóa từ khóa tìm kiếm"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="stores-list">
          {!hasConfiguredStores ? (
            <div className="stores-empty">
              <span className="material-symbols-outlined">storefront</span>
              <h2>{EMPTY_TITLE}</h2>
              <p>{EMPTY_DESCRIPTION}</p>
            </div>
          ) : !hasSearchResults ? (
            <div className="stores-empty">
              <span className="material-symbols-outlined">search_off</span>
              <h2>Không tìm thấy cửa hàng phù hợp</h2>
              <p>Thử đổi từ khóa tìm kiếm hoặc xóa bộ lọc để xem toàn bộ hệ thống cửa hàng.</p>
              <button type="button" className="stores-empty-btn" onClick={() => setSearch('')}>
                Xóa tìm kiếm
              </button>
            </div>
          ) : (
            filteredStores.map((store) => (
              <div
                key={store.id}
                role="button"
                tabIndex={0}
                className={`stores-card${activeStore?.id === store.id ? ' stores-card--active' : ''}`}
                onClick={() => setActiveId(store.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveId(store.id);
                  }
                }}
              >
                {store.imageUrl ? (
                  <div className="stores-card-media">
                    <img src={store.imageUrl} alt={store.name || 'Cửa hàng'} className="stores-card-thumb" />
                  </div>
                ) : null}

                <div className="stores-card-body">
                  <div className="stores-card-top">
                    <div className="stores-card-headline">
                      <h2 className="stores-card-name">{store.name}</h2>
                      {store.city ? <p className="stores-card-city">{store.city}</p> : null}
                    </div>
                    {store.tag ? <span className="stores-card-tag">{store.tag}</span> : null}
                  </div>

                  <div className="stores-card-info">
                    {store.address ? (
                      <div className="stores-card-row">
                        <span className="material-symbols-outlined">location_on</span>
                        <p>{store.address}</p>
                      </div>
                    ) : null}
                    {store.phone ? (
                      <div className="stores-card-row">
                        <span className="material-symbols-outlined">call</span>
                        <a href={buildPhoneLink(store.phone)} onClick={(event) => event.stopPropagation()}>
                          {store.phone}
                        </a>
                      </div>
                    ) : null}
                    {store.openingHours ? (
                      <div className="stores-card-row">
                        <span className="material-symbols-outlined">schedule</span>
                        <p>{store.openingHours}</p>
                      </div>
                    ) : null}
                  </div>

                  {store.mapExternalUrl ? (
                    <div className="stores-card-actions">
                      <a
                        href={store.mapExternalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="stores-card-btn"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="material-symbols-outlined">directions</span>
                        Chỉ đường
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="stores-hotline">
          <p className="stores-hotline-label">Hỗ trợ khách hàng</p>
          {supportHotline ? (
            <a href={buildPhoneLink(supportHotline)} className="stores-hotline-number">
              <span className="material-symbols-outlined">headset_mic</span>
              Hotline: {supportHotline}
            </a>
          ) : (
            <p className="stores-hotline-number stores-hotline-number--muted">Đang cập nhật hotline</p>
          )}
        </div>
      </aside>

      <section className="stores-map">
        {activeStore && hasSearchResults ? (
          <>
            <iframe
              key={activeStore.id}
              className="stores-map-iframe"
              src={activeStore.mapEmbedUrl}
              allowFullScreen=""
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title={`Bản đồ ${activeStore.name}`}
            />

            <div className="stores-map-pin">
              <div className="stores-map-popup">
                <p className="stores-map-popup-label">Bạn đang xem</p>
                <p className="stores-map-popup-name">{activeStore.name}</p>
              </div>
              <span className="material-symbols-outlined stores-map-pin-icon">location_on</span>
            </div>

            {activeStore.mapExternalUrl ? (
              <div className="stores-map-controls">
                <a
                  href={activeStore.mapExternalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="stores-map-ctrl stores-map-ctrl--location"
                  title="Mở trong Google Maps"
                >
                  <span className="material-symbols-outlined">my_location</span>
                </a>
              </div>
            ) : null}
          </>
        ) : (
          <div className="stores-map-empty">
            <span className="material-symbols-outlined">
              {hasConfiguredStores ? 'travel_explore' : 'location_off'}
            </span>
            <h2>{hasConfiguredStores ? 'Không có kết quả phù hợp' : EMPTY_TITLE}</h2>
            <p>
              {hasConfiguredStores
                ? 'Không tìm thấy cửa hàng trùng với từ khóa hiện tại. Hãy thử tên, địa chỉ hoặc thành phố khác.'
                : EMPTY_DESCRIPTION}
            </p>
          </div>
        )}
      </section>

      <style>{`
        .stores-page {
          --stores-card-name-size: 1rem;
          --stores-title-size: calc(var(--stores-card-name-size) * 1.2);
          display: grid;
          grid-template-columns: minmax(320px, 384px) minmax(0, 1fr);
          min-height: calc(100vh - 84px);
          background: #f7f1e8;
          font-family: 'Noto Serif', serif;
        }

        .stores-sidebar {
          display: flex;
          flex-direction: column;
          min-width: 0;
          background: linear-gradient(180deg, #fbf6ef 0%, #f4ece2 100%);
          border-right: 1px solid rgba(197, 160, 101, 0.2);
          box-shadow: 14px 0 34px rgba(27, 54, 93, 0.08);
          z-index: 2;
        }

        .stores-sidebar-header {
          padding: 1.35rem;
          border-bottom: 1px solid rgba(197, 160, 101, 0.16);
        }

        .stores-sidebar-eyebrow {
          margin: 0 0 0.42rem;
          font-size: 0.66rem;
          font-weight: 800;
          letter-spacing: 0.24em;
          color: rgba(27, 54, 93, 0.55);
          text-transform: uppercase;
        }

        .stores-sidebar-title {
          margin: 0;
          font-family: 'Playfair Display', serif;
          font-size: var(--stores-title-size);
          line-height: 1.2;
          color: #1b365d;
        }

        .stores-search-wrap {
          position: relative;
          margin-top: 0.7rem;
        }

        .stores-search-icon {
          position: absolute;
          left: 0.85rem;
          top: 50%;
          transform: translateY(-50%);
          color: #c5a065;
          font-size: 1.1rem;
        }

        .stores-search-input {
          width: 100%;
          height: 44px;
          padding: 0 2.75rem 0 2.7rem;
          border: 1px solid rgba(27, 54, 93, 0.14);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.95);
          color: #1b365d;
          font-size: 0.88rem;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }

        .stores-search-input:focus {
          border-color: rgba(27, 54, 93, 0.45);
          box-shadow: 0 0 0 4px rgba(27, 54, 93, 0.08);
        }

        .stores-search-input:disabled {
          cursor: not-allowed;
          color: rgba(27, 54, 93, 0.4);
          background: rgba(255, 255, 255, 0.6);
        }

        .stores-search-input::placeholder {
          color: rgba(27, 54, 93, 0.38);
        }

        .stores-search-clear {
          position: absolute;
          right: 0.65rem;
          top: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          transform: translateY(-50%);
          border: none;
          background: transparent;
          color: rgba(27, 54, 93, 0.42);
          cursor: pointer;
        }

        .stores-list {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.82rem;
        }

        .stores-list::-webkit-scrollbar {
          width: 6px;
        }

        .stores-list::-webkit-scrollbar-thumb {
          background: rgba(197, 160, 101, 0.6);
          border-radius: 999px;
        }

        .stores-empty {
          min-height: 240px;
          border: 1px dashed rgba(27, 54, 93, 0.16);
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.58);
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          color: rgba(27, 54, 93, 0.72);
        }

        .stores-empty .material-symbols-outlined {
          font-size: 2.9rem;
          color: #c5a065;
        }

        .stores-empty h2 {
          margin: 0.9rem 0 0.45rem;
          font-family: 'Playfair Display', serif;
          font-size: 1.35rem;
          color: #1b365d;
        }

        .stores-empty p {
          margin: 0;
          max-width: 28rem;
          line-height: 1.7;
        }

        .stores-empty-btn {
          margin-top: 1rem;
          height: 40px;
          padding: 0 1rem;
          border: 1px solid rgba(27, 54, 93, 0.16);
          border-radius: 999px;
          background: #1b365d;
          color: #fff;
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          cursor: pointer;
        }

        .stores-card {
          width: 100%;
          border: 1px solid rgba(27, 54, 93, 0.08);
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 0 12px 28px rgba(27, 54, 93, 0.06);
          padding: 0.9rem;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 0.95rem;
          text-align: left;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .stores-card:hover,
        .stores-card--active {
          transform: translateY(-1px);
          border-color: rgba(197, 160, 101, 0.48);
          box-shadow: 0 16px 36px rgba(27, 54, 93, 0.12);
        }

        .stores-card:focus-visible {
          outline: 3px solid rgba(197, 160, 101, 0.38);
          outline-offset: 3px;
        }

        .stores-card-media {
          width: 88px;
          height: 88px;
          border-radius: 16px;
          overflow: hidden;
          background: #efe7db;
          flex-shrink: 0;
        }

        .stores-card-thumb {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .stores-card-body {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
        }

        .stores-card-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.75rem;
        }

        .stores-card-headline {
          min-width: 0;
        }

        .stores-card-name {
          margin: 0;
          font-family: 'Playfair Display', serif;
          font-size: var(--stores-card-name-size);
          line-height: 1.3;
          color: #1b365d;
        }

        .stores-card-city {
          margin: 0.25rem 0 0;
          font-size: 0.78rem;
          font-weight: 700;
          color: rgba(27, 54, 93, 0.62);
          text-transform: uppercase;
          letter-spacing: 0.14em;
        }

        .stores-card-tag {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 28px;
          padding: 0.16rem 0.62rem;
          border-radius: 999px;
          background: rgba(197, 160, 101, 0.16);
          color: #1b365d;
          font-size: 0.64rem;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .stores-card-info {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }

        .stores-card-row {
          display: flex;
          align-items: flex-start;
          gap: 0.55rem;
          font-size: 0.84rem;
          line-height: 1.55;
          color: rgba(27, 54, 93, 0.76);
        }

        .stores-card-row .material-symbols-outlined {
          margin-top: 0.12rem;
          font-size: 1rem;
          color: #c5a065;
          flex-shrink: 0;
        }

        .stores-card-row p,
        .stores-card-row a {
          margin: 0;
          color: inherit;
          text-decoration: none;
        }

        .stores-card-row a:hover {
          color: #1b365d;
          text-decoration: underline;
        }

        .stores-card-actions {
          padding-top: 0.1rem;
        }

        .stores-card-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          min-height: 36px;
          padding: 0 0.82rem;
          border-radius: 999px;
          background: #1b365d;
          color: #fff;
          font-size: 0.7rem;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          text-decoration: none;
          transition: background 0.2s ease, transform 0.2s ease;
        }

        .stores-card-btn:hover {
          background: #c5a065;
          transform: translateY(-1px);
        }

        .stores-hotline {
          padding: 0.95rem 1.2rem 1.15rem;
          background: #1b365d;
        }

        .stores-hotline-label {
          margin: 0 0 0.35rem;
          font-size: 0.64rem;
          font-weight: 800;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: rgba(249, 245, 240, 0.62);
        }

        .stores-hotline-number {
          margin: 0;
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          color: #fff;
          text-decoration: none;
          font-family: 'Playfair Display', serif;
          font-size: 0.94rem;
          line-height: 1.4;
          transition: opacity 0.2s ease;
        }

        .stores-hotline-number:hover {
          opacity: 0.85;
        }

        .stores-hotline-number--muted {
          color: rgba(249, 245, 240, 0.7);
        }

        .stores-map {
          position: relative;
          min-width: 0;
          background: linear-gradient(135deg, #e8dece 0%, #d9cdbb 100%);
          overflow: hidden;
        }

        .stores-map-iframe,
        .stores-map-empty {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }

        .stores-map-iframe {
          border: none;
          filter: saturate(0.88) contrast(1.04);
        }

        .stores-map-pin {
          position: absolute;
          top: 15%;
          left: 50%;
          z-index: 3;
          display: flex;
          flex-direction: column;
          align-items: center;
          transform: translateX(-50%);
          pointer-events: none;
        }

        .stores-map-popup {
          padding: 0.62rem 0.9rem;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 18px 32px rgba(27, 54, 93, 0.18);
          text-align: center;
          white-space: nowrap;
        }

        .stores-map-popup-label {
          margin: 0 0 0.16rem;
          color: rgba(27, 54, 93, 0.5);
          font-size: 0.62rem;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .stores-map-popup-name {
          margin: 0;
          color: #1b365d;
          font-family: 'Playfair Display', serif;
          font-size: 0.9rem;
          font-weight: 700;
        }

        .stores-map-pin-icon {
          margin-top: -0.1rem;
          font-size: 2.6rem;
          color: #1b365d;
          filter: drop-shadow(0 12px 18px rgba(27, 54, 93, 0.24));
        }

        .stores-map-controls {
          position: absolute;
          top: 1.25rem;
          right: 1.25rem;
          z-index: 3;
        }

        .stores-map-ctrl {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: rgba(27, 54, 93, 0.95);
          color: #fff;
          text-decoration: none;
          box-shadow: 0 12px 30px rgba(27, 54, 93, 0.22);
          transition: background 0.2s ease, transform 0.2s ease;
        }

        .stores-map-ctrl:hover {
          background: #c5a065;
          transform: translateY(-1px);
        }

        .stores-map-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 2rem;
          color: rgba(27, 54, 93, 0.72);
        }

        .stores-map-empty .material-symbols-outlined {
          font-size: 4rem;
          color: #c5a065;
        }

        .stores-map-empty h2 {
          margin: 1rem 0 0.5rem;
          font-family: 'Playfair Display', serif;
          font-size: 1.4rem;
          color: #1b365d;
        }

        .stores-map-empty p {
          max-width: 36rem;
          margin: 0;
          line-height: 1.68;
        }

        @media (max-width: 920px) {
          .stores-page {
            grid-template-columns: 1fr;
            min-height: auto;
          }

          .stores-sidebar {
            box-shadow: none;
            border-right: none;
            border-bottom: 1px solid rgba(197, 160, 101, 0.18);
          }

          .stores-list {
            max-height: 56vh;
          }

          .stores-map {
            min-height: 70vh;
          }

          .stores-map-pin {
            display: none;
          }
        }

        @media (max-width: 640px) {
          .stores-sidebar-header,
          .stores-list,
          .stores-hotline {
            padding-left: 1rem;
            padding-right: 1rem;
          }

          .stores-card {
            grid-template-columns: 1fr;
          }

          .stores-card-media {
            width: 100%;
            height: 160px;
          }

          .stores-card-top {
            flex-direction: column;
            align-items: flex-start;
          }

          .stores-map {
            min-height: 64vh;
          }
        }
      `}</style>
    </div>
  );
}

