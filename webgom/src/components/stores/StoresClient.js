"use client";

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { resolveMediaUrl } from '@/lib/media';

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
        imageUrl: resolveMediaUrl(item.image_url || item.imageUrl),
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
  const [previewImage, setPreviewImage] = useState(null);

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
  const activeRegionLabel = activeStore ? buildRegionLabel(activeStore) : '';
  const activePhone = activeStore ? getPrimaryPhone(activeStore) : '';

  useEffect(() => {
    if (!previewImage) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setPreviewImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewImage]);

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
                      <div className="stores-card-overview">
                        <div className="stores-card-copy">
                          <div className="stores-card-badges">
                            {store.city ? <span className="stores-card-region">{store.city}</span> : null}
                            {store.tag ? <span className="stores-card-tag">{store.tag}</span> : null}
                          </div>
                          <div className="stores-card-copy-body">
                            <h3 className="stores-card-name">{store.name}</h3>
                            {store.imageUrl ? <p className="stores-card-hint">Chạm vào ảnh để xem lớn hơn</p> : null}
                            {store.note ? <p className="stores-card-note">{store.note}</p> : null}
                          </div>
                        </div>

                        <div className="stores-card-media">
                          {store.imageUrl ? (
                            <button
                              type="button"
                              className="stores-card-media-trigger"
                              onClick={(event) => {
                                event.stopPropagation();
                                setPreviewImage({
                                  src: store.imageUrl,
                                  alt: store.name ? `Hình ảnh ${store.name}` : 'Hình ảnh cửa hàng',
                                  title: store.name,
                                });
                              }}
                              aria-label={store.name ? `Phóng to ảnh ${store.name}` : 'Phóng to ảnh cửa hàng'}
                            >
                              <Image
                                src={store.imageUrl}
                                alt={store.name ? `Hình ảnh ${store.name}` : 'Hình ảnh cửa hàng'}
                                width={320}
                                height={320}
                                sizes="(max-width: 389px) 100vw, 156px"
                                className="stores-card-image"
                                unoptimized
                              />
                              <span className="stores-card-media-zoom">
                                <span className="material-symbols-outlined">zoom_in</span>
                              </span>
                            </button>
                          ) : (
                            <div className="stores-card-media-fallback">
                              <span className="material-symbols-outlined">storefront</span>
                              <span>Cửa hàng</span>
                            </div>
                          )}

                          {isActive ? <span className="stores-card-media-badge">Đang xem</span> : null}
                        </div>
                      </div>

                      <div className="stores-card-info-grid">
                        {store.address ? (
                          <div className="stores-card-detail stores-card-detail--wide">
                            <div className="stores-card-detail-label">
                              <span className="material-symbols-outlined">location_on</span>
                              <span>Địa chỉ</span>
                            </div>
                            <p className="stores-card-detail-value">{store.address}</p>
                          </div>
                        ) : null}

                        {phone ? (
                          <div className="stores-card-detail">
                            <div className="stores-card-detail-label">
                              <span className="material-symbols-outlined">call</span>
                              <span>Số điện thoại</span>
                            </div>
                            <div className="stores-card-detail-value">
                              <a href={buildPhoneLink(phone)} onClick={(event) => event.stopPropagation()}>
                                {phone}
                              </a>
                            </div>
                          </div>
                        ) : null}

                        {store.openingHours ? (
                          <div className="stores-card-detail">
                            <div className="stores-card-detail-label">
                              <span className="material-symbols-outlined">schedule</span>
                              <span>Giờ mở cửa</span>
                            </div>
                            <p className="stores-card-detail-value">{store.openingHours}</p>
                          </div>
                        ) : null}
                      </div>

                      {store.mapExternalUrl ? (
                        <div className="stores-card-actions">
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
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>

      {previewImage ? (
        <div className="stores-lightbox" role="dialog" aria-modal="true" aria-label="Xem ảnh cửa hàng">
          <button
            type="button"
            className="stores-lightbox-backdrop"
            aria-label="Đóng ảnh xem lớn"
            onClick={() => setPreviewImage(null)}
          />
          <div className="stores-lightbox-dialog" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="stores-lightbox-close"
              aria-label="Đóng ảnh xem lớn"
              onClick={() => setPreviewImage(null)}
            >
              <span className="material-symbols-outlined">close</span>
            </button>

            <div className="stores-lightbox-frame">
              <Image
                src={previewImage.src}
                alt={previewImage.alt}
                width={1400}
                height={1400}
                className="stores-lightbox-image"
                unoptimized
              />
            </div>

            {previewImage.title ? <p className="stores-lightbox-title">{previewImage.title}</p> : null}
          </div>
        </div>
      ) : null}

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
        .stores-spotlight-kicker {
          color: rgba(27, 54, 93, 0.58);
        }

        .stores-hero-title,
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

        .stores-content {
          display: grid;
          gap: 1rem;
        }

        .stores-list-panel {
          padding: 0;
          border: none;
          background: transparent;
          box-shadow: none;
          backdrop-filter: none;
        }

        .stores-list {
          margin-top: 0;
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
        }

        .stores-card {
          border: 1px solid rgba(197, 160, 101, 0.24);
          border-radius: 24px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 241, 232, 0.92));
          box-shadow: 0 14px 30px rgba(27, 54, 93, 0.06);
          padding: 0;
          overflow: hidden;
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

        .stores-card-overview {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 154px;
          gap: 0.85rem;
          align-items: center;
          padding: 1rem 1rem 0;
        }

        .stores-card-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          min-height: 154px;
          padding-bottom: 0.25rem;
        }

        .stores-card-copy-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: center;
          text-align: left;
          gap: 0.28rem;
        }

        .stores-card-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
        }

        .stores-card-region,
        .stores-card-tag {
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

        .stores-card-name {
          margin: 0;
          font-size: 1.38rem;
          line-height: 1.06;
          color: var(--primary);
          text-wrap: balance;
        }

        .stores-card-hint {
          margin: 0;
          color: rgba(27, 54, 93, 0.6);
          font-family: var(--font-sans);
          font-size: 0.72rem;
          font-weight: 600;
          line-height: 1.45;
        }

        .stores-card-note {
          margin: 0;
          color: rgba(27, 54, 93, 0.68);
          font-size: 0.9rem;
          line-height: 1.52;
          text-align: left;
          max-width: 16rem;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .stores-card-media {
          position: relative;
          min-height: 154px;
          border-radius: 20px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.55rem;
          background: linear-gradient(135deg, rgba(197, 160, 101, 0.18), rgba(27, 54, 93, 0.12));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }

        .stores-card-media-trigger {
          position: relative;
          width: 100%;
          height: 100%;
          border: none;
          padding: 0;
          background: transparent;
          cursor: zoom-in;
        }

        .stores-card-image {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          object-position: center;
          border-radius: 16px;
        }

        .stores-card-media-zoom {
          position: absolute;
          right: 0.5rem;
          top: 0.5rem;
          width: 30px;
          height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.88);
          color: var(--primary);
          box-shadow: 0 10px 16px rgba(27, 54, 93, 0.14);
        }

        .stores-card-media-zoom .material-symbols-outlined {
          font-size: 1rem;
        }

        .stores-card-media-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          color: var(--primary);
          font-family: var(--font-sans);
          font-size: 0.66rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .stores-card-media-fallback .material-symbols-outlined {
          font-size: 1.65rem;
          color: var(--accent);
        }

        .stores-card-media-badge {
          position: absolute;
          left: 0.6rem;
          bottom: 0.6rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 28px;
          padding: 0.18rem 0.68rem;
          border-radius: 999px;
          background: rgba(27, 54, 93, 0.92);
          color: #fff;
          font-family: var(--font-sans);
          font-size: 0.66rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          box-shadow: 0 8px 18px rgba(27, 54, 93, 0.18);
        }

        .stores-card-info-grid,
        .stores-spotlight-info {
          margin-top: 0.95rem;
          display: grid;
          gap: 0.7rem;
        }

        .stores-card-info-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          padding: 0 1rem;
          margin-top: 0.15rem;
        }

        .stores-card-detail {
          min-width: 0;
          padding: 0.78rem 0.82rem;
          border-radius: 18px;
          background: rgba(27, 54, 93, 0.04);
          border: 1px solid rgba(27, 54, 93, 0.08);
        }

        .stores-card-detail--wide {
          grid-column: 1 / -1;
        }

        .stores-card-detail-label {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          color: rgba(27, 54, 93, 0.48);
          font-family: var(--font-sans);
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .stores-card-detail-label .material-symbols-outlined {
          font-size: 1rem;
          color: var(--accent);
        }

        .stores-card-detail-value {
          margin: 0.42rem 0 0;
          color: rgba(27, 54, 93, 0.84);
          font-size: 0.96rem;
          line-height: 1.55;
          word-break: break-word;
        }

        .stores-card-detail-value a {
          color: inherit;
          text-decoration: none;
        }

        .stores-card-detail-value a:hover {
          color: var(--primary);
          text-decoration: underline;
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

        .stores-card-actions .stores-action-btn {
          width: 100%;
        }

        .stores-card-actions {
          padding: 0 1rem 1rem;
          margin-top: 0.85rem;
        }

        .stores-lightbox {
          position: fixed;
          inset: 0;
          z-index: 1400;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }

        .stores-lightbox-backdrop {
          position: absolute;
          inset: 0;
          border: none;
          background: rgba(10, 20, 36, 0.72);
          backdrop-filter: blur(8px);
          cursor: pointer;
        }

        .stores-lightbox-dialog {
          position: relative;
          z-index: 1;
          width: min(100%, 560px);
          padding: 0.9rem;
          border-radius: 26px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 241, 232, 0.98));
          box-shadow: 0 26px 70px rgba(10, 20, 36, 0.28);
        }

        .stores-lightbox-close {
          position: absolute;
          top: 0.75rem;
          right: 0.75rem;
          width: 38px;
          height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 999px;
          background: rgba(27, 54, 93, 0.92);
          color: #fff;
          cursor: pointer;
        }

        .stores-lightbox-frame {
          border-radius: 20px;
          overflow: hidden;
          background: linear-gradient(135deg, rgba(197, 160, 101, 0.18), rgba(27, 54, 93, 0.12));
          min-height: 280px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }

        .stores-lightbox-image {
          width: 100%;
          height: auto;
          max-height: 72vh;
          object-fit: contain;
        }

        .stores-lightbox-title {
          margin: 0.9rem 0 0;
          text-align: center;
          color: var(--primary);
          font-family: var(--font-display);
          font-size: 1.2rem;
          line-height: 1.3;
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

          .stores-card-overview {
            grid-template-columns: minmax(0, 1fr) 164px;
            padding: 1.05rem 1.05rem 0;
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
            padding: 0;
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

          .stores-card,
          .stores-spotlight-card,
          .stores-spotlight-empty {
            padding: 0.95rem;
          }

          .stores-card {
            padding: 0;
          }

          .stores-card-name {
            font-size: 1.24rem;
          }

          .stores-card-hint {
            font-size: 0.68rem;
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
        }

        @media (max-width: 389px) {
          .stores-card-overview {
            grid-template-columns: 1fr;
            padding: 1rem 1rem 0;
          }

          .stores-card-copy {
            min-height: auto;
            padding-bottom: 0.85rem;
          }

          .stores-card-copy-body {
            min-height: 96px;
            align-items: center;
            text-align: center;
          }

          .stores-card-media {
            min-height: 182px;
            border-radius: 18px;
          }

          .stores-card-info-grid {
            grid-template-columns: 1fr;
          }
        }`}</style>
    </div>
  );
}
