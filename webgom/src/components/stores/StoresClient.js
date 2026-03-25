"use client";

import { useMemo, useState } from 'react';

const EMPTY_TITLE = 'Hệ thống cửa hàng đang cập nhật';
const EMPTY_DESCRIPTION =
  'Thông tin showroom và chi nhánh sẽ hiển thị tại đây ngay sau khi được cập nhật trong Cài đặt web.';

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

const buildRegionLabel = (store) => [store.city, store.tag].filter(Boolean).join(' - ');

const getPrimaryPhone = (store) => asText(store.phone || store.hotline);

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
        note: asText(item.note),
        isActive: item.is_active === undefined ? true : Boolean(item.is_active),
        order: Number(item.order ?? item.sort_order ?? index + 1) || index + 1,
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

function InfoRow({ icon, label, children }) {
  return (
    <div className="stores-info-row">
      <span className="material-symbols-outlined stores-info-row-icon">{icon}</span>
      <div className="stores-info-row-body">
        <span className="stores-info-row-label">{label}</span>
        <div className="stores-info-row-content">{children}</div>
      </div>
    </div>
  );
}

export default function StoresClient({ stores = [] }) {
  const normalizedStores = useMemo(() => normalizeStores(stores), [stores]);
  const [activeId, setActiveId] = useState('');

  const resolvedActiveId = useMemo(() => {
    if (!normalizedStores.length) {
      return '';
    }

    return normalizedStores.some((store) => store.id === activeId) ? activeId : normalizedStores[0].id;
  }, [normalizedStores, activeId]);

  const activeStore = useMemo(
    () => normalizedStores.find((store) => store.id === resolvedActiveId) || normalizedStores[0] || null,
    [normalizedStores, resolvedActiveId]
  );

  const hasConfiguredStores = normalizedStores.length > 0;
  const resultsLabel = `${normalizedStores.length} địa chỉ`;
  const activeRegionLabel = activeStore ? buildRegionLabel(activeStore) : '';
  const activePhone = activeStore ? getPrimaryPhone(activeStore) : '';

  return (
    <div className="stores-page">
      <div className="stores-shell">
        <section className="stores-hero">
          <h1 className="stores-hero-title">Hệ thống cửa hàng</h1>
        </section>

        <div className="stores-content">
          <section className="stores-spotlight">
            {activeStore ? (
              <div className="stores-spotlight-card">
                <div className="stores-spotlight-head">
                  <div className="stores-spotlight-icon">
                    <span className="material-symbols-outlined">location_on</span>
                  </div>
                  <div className="stores-spotlight-copy">
                    <p className="stores-spotlight-kicker">Địa điểm đang chọn</p>
                    <h2 className="stores-spotlight-title">{activeStore.name}</h2>
                    <p className="stores-spotlight-subtitle">{activeRegionLabel || 'Thông tin khu vực đang cập nhật'}</p>
                  </div>
                </div>

                <div className="stores-spotlight-info">
                  {activeStore.address ? (
                    <InfoRow icon="location_on" label="Địa chỉ">
                      <p>{activeStore.address}</p>
                    </InfoRow>
                  ) : null}

                  {activePhone ? (
                    <InfoRow icon="call" label="Số điện thoại">
                      <a href={buildPhoneLink(activePhone)}>{activePhone}</a>
                    </InfoRow>
                  ) : null}

                  {activeStore.openingHours ? (
                    <InfoRow icon="schedule" label="Giờ mở cửa">
                      <p>{activeStore.openingHours}</p>
                    </InfoRow>
                  ) : null}

                  {activeStore.email ? (
                    <InfoRow icon="mail" label="Email">
                      <a href={buildMailLink(activeStore.email)}>{activeStore.email}</a>
                    </InfoRow>
                  ) : null}

                  {activeStore.note ? (
                    <InfoRow icon="info" label="Ghi chú">
                      <p>{activeStore.note}</p>
                    </InfoRow>
                  ) : null}
                </div>

                <div className="stores-spotlight-actions">
                  {activePhone ? (
                    <a href={buildPhoneLink(activePhone)} className="stores-action-btn stores-action-btn--ghost">
                      <span className="material-symbols-outlined">call</span>
                      Gọi cửa hàng
                    </a>
                  ) : null}

                  {activeStore.mapExternalUrl ? (
                    <a
                      href={activeStore.mapExternalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="stores-action-btn"
                    >
                      <span className="material-symbols-outlined">directions</span>
                      Chỉ đường
                    </a>
                  ) : null}
                </div>

                <div className="stores-map-card">
                  {activeStore.mapEmbedUrl ? (
                    <iframe
                      key={activeStore.id}
                      className="stores-map-iframe"
                      src={activeStore.mapEmbedUrl}
                      allowFullScreen=""
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      title={`Bản đồ ${activeStore.name}`}
                    />
                  ) : (
                    <div className="stores-map-empty">
                      <span className="material-symbols-outlined">map</span>
                      <h3>Chưa có bản đồ nhúng</h3>
                      <p>Vẫn có thể dùng nút chỉ đường phía trên để mở Google Maps.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="stores-spotlight-empty">
                <span className="material-symbols-outlined">location_off</span>
                <h2>{EMPTY_TITLE}</h2>
                <p>{EMPTY_DESCRIPTION}</p>
              </div>
            )}
          </section>

          <section className="stores-list-panel">
            <div className="stores-list-header">
              <div>
                <p className="stores-list-eyebrow">Danh sách cửa hàng</p>
                <h2 className="stores-list-title">Chạm vào từng địa điểm để xem nhanh thông tin</h2>
              </div>
              {hasConfiguredStores ? (
                <span className="stores-results-badge stores-results-badge--secondary">{resultsLabel}</span>
              ) : null}
            </div>

            <div className="stores-list">
              {!hasConfiguredStores ? (
                <div className="stores-empty">
                  <span className="material-symbols-outlined">storefront</span>
                  <h2>{EMPTY_TITLE}</h2>
                  <p>{EMPTY_DESCRIPTION}</p>
                </div>
              ) : (
                normalizedStores.map((store) => {
                  const isActive = activeStore?.id === store.id;
                  const phone = getPrimaryPhone(store);

                  return (
                    <div
                      key={store.id}
                      role="button"
                      tabIndex={0}
                      className={`stores-card${isActive ? ' stores-card--active' : ''}`}
                      onClick={() => setActiveId(store.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setActiveId(store.id);
                        }
                      }}
                    >
                      <div className="stores-card-heading">
                        <span className="material-symbols-outlined stores-card-icon">storefront</span>
                        <div className="stores-card-heading-copy">
                          <div className="stores-card-badges">
                            {store.city ? <span className="stores-card-region">{store.city}</span> : null}
                            {store.tag ? <span className="stores-card-tag">{store.tag}</span> : null}
                            {isActive ? <span className="stores-card-status">Đang xem</span> : null}
                          </div>
                          <h3 className="stores-card-name">{store.name}</h3>
                        </div>
                        <span className="material-symbols-outlined stores-card-arrow">
                          {isActive ? 'radio_button_checked' : 'arrow_outward'}
                        </span>
                      </div>

                      <div className="stores-card-info">
                        {store.address ? (
                          <InfoRow icon="location_on" label="Địa chỉ">
                            <p>{store.address}</p>
                          </InfoRow>
                        ) : null}

                        {phone ? (
                          <InfoRow icon="call" label="Số điện thoại">
                            <a href={buildPhoneLink(phone)} onClick={(event) => event.stopPropagation()}>
                              {phone}
                            </a>
                          </InfoRow>
                        ) : null}

                        {store.openingHours ? (
                          <InfoRow icon="schedule" label="Giờ mở cửa">
                            <p>{store.openingHours}</p>
                          </InfoRow>
                        ) : null}
                      </div>

                      <div className="stores-card-actions">
                        {phone ? (
                          <a
                            href={buildPhoneLink(phone)}
                            className="stores-action-btn stores-action-btn--ghost"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span className="material-symbols-outlined">call</span>
                            Gọi ngay
                          </a>
                        ) : null}

                        {store.mapExternalUrl ? (
                          <a
                            href={store.mapExternalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="stores-action-btn"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span className="material-symbols-outlined">directions</span>
                            Chỉ đường
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>

      <style>{`
        .stores-page {
          background:
            radial-gradient(circle at top, rgba(197, 160, 101, 0.14), transparent 34%),
            linear-gradient(180deg, #fdfbf7 0%, #f4ece2 100%);
        }

        .stores-shell {
          width: min(100%, 1160px);
          margin: 0 auto;
          padding: 0.95rem 0.85rem 5.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .stores-hero,
        .stores-list-panel,
        .stores-spotlight-card,
        .stores-spotlight-empty {
          border: 1px solid rgba(27, 54, 93, 0.08);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.78);
          box-shadow: 0 18px 40px rgba(27, 54, 93, 0.08);
          backdrop-filter: blur(10px);
        }

        .stores-hero {
          padding: 0.95rem 1.05rem;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(247, 241, 232, 0.98)),
            rgba(255, 255, 255, 0.72);
        }

        .stores-hero-eyebrow,
        .stores-list-eyebrow,
        .stores-spotlight-kicker,
        .stores-search-label,
        .stores-info-row-label {
          font-family: var(--font-sans);
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .stores-hero-eyebrow,
        .stores-list-eyebrow,
        .stores-spotlight-kicker {
          color: rgba(27, 54, 93, 0.58);
        }

        .stores-hero-title,
        .stores-list-title,
        .stores-spotlight-title,
        .stores-empty h2,
        .stores-map-empty h3,
        .stores-spotlight-empty h2 {
          font-family: var(--font-display);
          color: var(--primary);
        }

        .stores-hero-title {
          margin: 0;
          font-size: clamp(1.95rem, 7vw, 2.4rem);
          line-height: 1.05;
        }

        .stores-hero-description {
          margin: 0.75rem 0 0;
          max-width: 42rem;
          color: rgba(27, 54, 93, 0.78);
          font-size: 1rem;
          line-height: 1.68;
        }

        .stores-hero-meta {
          margin-top: 1rem;
          display: grid;
          grid-template-columns: repeat(1, minmax(0, 1fr));
          gap: 0.75rem;
        }

        .stores-hero-card {
          display: flex;
          align-items: center;
          gap: 0.85rem;
          min-height: 66px;
          padding: 0.85rem 0.95rem;
          border: 1px solid rgba(27, 54, 93, 0.08);
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.82);
          color: var(--primary);
        }

        .stores-hero-card--link {
          text-decoration: none;
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .stores-hero-card--link:hover {
          transform: translateY(-1px);
          border-color: rgba(197, 160, 101, 0.4);
          box-shadow: 0 14px 26px rgba(27, 54, 93, 0.1);
        }

        .stores-hero-card--muted {
          color: rgba(27, 54, 93, 0.62);
        }

        .stores-hero-card-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: 16px;
          background: rgba(27, 54, 93, 0.08);
          color: var(--accent);
          font-size: 1.35rem;
          flex-shrink: 0;
        }

        .stores-hero-card-copy {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .stores-hero-card-copy strong {
          font-family: var(--font-display);
          font-size: 1.08rem;
          line-height: 1.1;
        }

        .stores-hero-card-copy span {
          margin-top: 0.18rem;
          font-family: var(--font-sans);
          font-size: 0.78rem;
          color: rgba(27, 54, 93, 0.7);
        }

        .stores-search-panel {
          margin-top: 1rem;
          padding: 0.95rem;
          border: 1px solid rgba(27, 54, 93, 0.08);
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.9);
        }

        .stores-search-label {
          display: block;
          margin-bottom: 0.65rem;
          color: rgba(27, 54, 93, 0.62);
        }

        .stores-search-wrap {
          position: relative;
        }

        .stores-search-icon {
          position: absolute;
          left: 0.95rem;
          top: 50%;
          transform: translateY(-50%);
          color: var(--accent);
          font-size: 1.2rem;
        }

        .stores-search-input {
          width: 100%;
          height: 52px;
          padding: 0 3rem 0 2.9rem;
          border: 1px solid rgba(27, 54, 93, 0.12);
          border-radius: 18px;
          background: #fff;
          color: var(--primary);
          font-family: var(--font-sans);
          font-size: 0.95rem;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .stores-search-input:focus {
          border-color: rgba(27, 54, 93, 0.34);
          box-shadow: 0 0 0 4px rgba(27, 54, 93, 0.08);
        }

        .stores-search-input:disabled {
          cursor: not-allowed;
          color: rgba(27, 54, 93, 0.42);
          background: rgba(255, 255, 255, 0.72);
        }

        .stores-search-input::placeholder {
          color: rgba(27, 54, 93, 0.42);
        }

        .stores-search-clear {
          position: absolute;
          right: 0.55rem;
          top: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          transform: translateY(-50%);
          border: none;
          border-radius: 14px;
          background: transparent;
          color: rgba(27, 54, 93, 0.5);
          cursor: pointer;
        }

        .stores-search-clear:hover {
          background: rgba(27, 54, 93, 0.06);
        }

        .stores-toolbar,
        .stores-list-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .stores-toolbar {
          margin-top: 0.75rem;
        }

        .stores-toolbar-text {
          flex: 1;
          min-width: 12rem;
          color: rgba(27, 54, 93, 0.72);
          font-size: 0.92rem;
          line-height: 1.55;
        }

        .stores-results-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 32px;
          padding: 0.2rem 0.75rem;
          border-radius: 999px;
          background: rgba(197, 160, 101, 0.16);
          color: var(--primary);
          font-family: var(--font-sans);
          font-size: 0.74rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }

        .stores-results-badge--secondary {
          background: rgba(27, 54, 93, 0.08);
        }

        .stores-content {
          display: grid;
          gap: 1rem;
        }

        .stores-list-panel {
          padding: 1rem;
        }

        .stores-list-title {
          margin: 0.35rem 0 0;
          font-size: 1.55rem;
          line-height: 1.1;
        }

        .stores-list {
          margin-top: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
        }

        .stores-card {
          border: 1px solid rgba(27, 54, 93, 0.08);
          border-radius: 24px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 241, 232, 0.92));
          box-shadow: 0 14px 30px rgba(27, 54, 93, 0.06);
          padding: 1rem;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .stores-card:hover,
        .stores-card--active {
          transform: translateY(-1px);
          border-color: rgba(197, 160, 101, 0.42);
          box-shadow: 0 18px 36px rgba(27, 54, 93, 0.1);
        }

        .stores-card:focus-visible {
          outline: 3px solid rgba(197, 160, 101, 0.32);
          outline-offset: 3px;
        }

        .stores-card-heading {
          display: flex;
          align-items: flex-start;
          gap: 0.8rem;
        }

        .stores-card-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 46px;
          height: 46px;
          border-radius: 17px;
          background: rgba(27, 54, 93, 0.08);
          color: var(--accent);
          font-size: 1.35rem;
          flex-shrink: 0;
        }

        .stores-card-heading-copy {
          flex: 1;
          min-width: 0;
        }

        .stores-card-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
        }

        .stores-card-region,
        .stores-card-tag,
        .stores-card-status {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 28px;
          padding: 0.18rem 0.7rem;
          border-radius: 999px;
          font-family: var(--font-sans);
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .stores-card-region {
          background: rgba(27, 54, 93, 0.08);
          color: rgba(27, 54, 93, 0.8);
        }

        .stores-card-tag {
          background: rgba(197, 160, 101, 0.18);
          color: var(--primary);
        }

        .stores-card-status {
          background: rgba(27, 54, 93, 0.92);
          color: #fff;
        }

        .stores-card-name {
          margin: 0.55rem 0 0;
          font-size: 1.32rem;
          line-height: 1.14;
          color: var(--primary);
        }

        .stores-card-arrow {
          color: rgba(27, 54, 93, 0.48);
          font-size: 1.25rem;
          flex-shrink: 0;
        }

        .stores-card-info,
        .stores-spotlight-info {
          margin-top: 0.95rem;
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
        }

        .stores-info-row {
          display: flex;
          align-items: flex-start;
          gap: 0.7rem;
        }

        .stores-info-row-icon {
          margin-top: 0.08rem;
          color: var(--accent);
          font-size: 1.08rem;
          flex-shrink: 0;
        }

        .stores-info-row-body {
          min-width: 0;
        }

        .stores-info-row-label {
          color: rgba(27, 54, 93, 0.48);
        }

        .stores-info-row-content {
          margin-top: 0.18rem;
          color: rgba(27, 54, 93, 0.82);
          font-size: 0.98rem;
          line-height: 1.55;
        }

        .stores-info-row-content p,
        .stores-info-row-content a {
          margin: 0;
          color: inherit;
          text-decoration: none;
        }

        .stores-info-row-content a:hover {
          color: var(--primary);
          text-decoration: underline;
        }

        .stores-card-actions,
        .stores-spotlight-actions {
          margin-top: 1rem;
          display: flex;
          flex-wrap: wrap;
          gap: 0.65rem;
        }

        .stores-action-btn,
        .stores-reset-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.45rem;
          min-height: 46px;
          padding: 0 1rem;
          border: 1px solid transparent;
          border-radius: 16px;
          background: var(--primary);
          color: #fff;
          font-family: var(--font-sans);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          text-decoration: none;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease;
        }

        .stores-action-btn:hover,
        .stores-reset-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 26px rgba(27, 54, 93, 0.16);
        }

        .stores-action-btn--ghost {
          background: rgba(27, 54, 93, 0.04);
          border-color: rgba(27, 54, 93, 0.12);
          color: var(--primary);
        }

        .stores-action-btn--ghost:hover {
          background: rgba(27, 54, 93, 0.08);
        }

        .stores-spotlight {
          order: 1;
        }

        .stores-spotlight-card,
        .stores-spotlight-empty {
          padding: 1rem;
        }

        .stores-spotlight-head {
          display: flex;
          align-items: flex-start;
          gap: 0.85rem;
        }

        .stores-spotlight-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 52px;
          border-radius: 18px;
          background: rgba(27, 54, 93, 0.08);
          color: var(--accent);
          flex-shrink: 0;
        }

        .stores-spotlight-copy {
          min-width: 0;
        }

        .stores-spotlight-title {
          margin: 0.35rem 0 0;
          font-size: 1.65rem;
          line-height: 1.08;
        }

        .stores-spotlight-subtitle {
          margin: 0.38rem 0 0;
          color: rgba(27, 54, 93, 0.66);
          font-size: 0.95rem;
          line-height: 1.5;
        }

        .stores-map-card {
          margin-top: 1rem;
          min-height: 220px;
          border-radius: 24px;
          overflow: hidden;
          border: 1px solid rgba(27, 54, 93, 0.08);
          background: linear-gradient(135deg, #e8dece 0%, #d9cdbb 100%);
        }

        .stores-map-iframe {
          display: block;
          width: 100%;
          height: 100%;
          min-height: 220px;
          border: none;
          filter: saturate(0.9) contrast(1.03);
        }

        .stores-map-empty,
        .stores-empty,
        .stores-spotlight-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .stores-map-empty {
          height: 100%;
          min-height: 220px;
          padding: 1.5rem;
          color: rgba(27, 54, 93, 0.72);
        }

        .stores-map-empty .material-symbols-outlined {
          font-size: 2.4rem;
          color: var(--accent);
        }

        .stores-map-empty h3 {
          margin: 0.85rem 0 0.4rem;
          font-size: 1.35rem;
        }

        .stores-map-empty p {
          margin: 0;
          line-height: 1.58;
        }

        .stores-empty {
          min-height: 280px;
          padding: 1.75rem 1.2rem;
          border: 1px dashed rgba(27, 54, 93, 0.16);
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.6);
          color: rgba(27, 54, 93, 0.72);
        }

        .stores-empty .material-symbols-outlined,
        .stores-spotlight-empty .material-symbols-outlined {
          font-size: 3rem;
          color: var(--accent);
        }

        .stores-empty h2,
        .stores-spotlight-empty h2 {
          margin: 0.9rem 0 0.45rem;
          font-size: 1.45rem;
        }

        .stores-empty p,
        .stores-spotlight-empty p {
          margin: 0;
          max-width: 32rem;
          line-height: 1.65;
        }

        .stores-spotlight-empty {
          min-height: 320px;
          gap: 0;
        }

        .stores-spotlight-empty .stores-reset-btn {
          margin-top: 1rem;
        }

        @media (min-width: 700px) {
          .stores-shell {
            padding-left: 1.25rem;
            padding-right: 1.25rem;
          }

          .stores-hero {
            padding: 1rem 1.35rem;
          }

          .stores-map-card,
          .stores-map-iframe,
          .stores-map-empty {
            min-height: 280px;
          }
        }

        @media (min-width: 992px) {
          .stores-content {
            grid-template-columns: minmax(0, 1.05fr) minmax(340px, 410px);
            align-items: start;
          }

          .stores-list-panel {
            order: 1;
            padding: 1.15rem;
          }

          .stores-spotlight {
            order: 2;
            position: sticky;
            top: 1.5rem;
          }

          .stores-spotlight-card,
          .stores-spotlight-empty {
            padding: 1.15rem;
          }

          .stores-map-card,
          .stores-map-iframe,
          .stores-map-empty {
            min-height: 360px;
          }
        }

        @media (max-width: 640px) {
          .stores-shell {
            padding: 0.8rem 0.75rem 5rem;
          }

          .stores-hero,
          .stores-list-panel,
          .stores-spotlight-card,
          .stores-spotlight-empty {
            border-radius: 24px;
          }

          .stores-hero-title {
            font-size: 2rem;
          }

          .stores-list-title {
            font-size: 1.35rem;
          }

          .stores-card,
          .stores-list-panel,
          .stores-spotlight-card,
          .stores-spotlight-empty {
            padding: 0.95rem;
          }

          .stores-card-name {
            font-size: 1.18rem;
          }

          .stores-spotlight-title {
            font-size: 1.45rem;
          }

          .stores-card-actions,
          .stores-spotlight-actions {
            flex-direction: column;
          }

          .stores-action-btn,
          .stores-reset-btn {
            width: 100%;
          }
        }`}</style>
    </div>
  );
}
