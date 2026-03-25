"use client";

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { resolveMediaUrl } from '@/lib/media';

const EMPTY_TITLE = 'Hệ thống cửa hàng đang cập nhật';
const EMPTY_DESCRIPTION =
  'Thông tin showroom và chi nhánh sẽ hiển thị tại đây ngay sau khi được cập nhật trong Cài đặt web.';

const asText = (value) => String(value || '').trim();

const normalizeSearchText = (value) =>
  asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

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

const matchesStore = (store, query, city) => {
  const matchesCity = !city || store.city === city;

  if (!matchesCity) {
    return false;
  }

  if (!query) {
    return true;
  }

  const haystack = normalizeSearchText(
    [store.name, store.city, store.tag, store.address, store.phone, store.hotline, store.note].join(' ')
  );

  return haystack.includes(query);
};

function DetailItem({ icon, label, children, wide = false }) {
  return (
    <div className={`stores-detail-item${wide ? ' stores-detail-item--wide' : ''}`}>
      <div className="stores-detail-label">
        <span className="material-symbols-outlined">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="stores-detail-value">{children}</div>
    </div>
  );
}

export default function StoresClient({ stores = [] }) {
  const normalizedStores = useMemo(() => normalizeStores(stores), [stores]);
  const [activeId, setActiveId] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCity, setSelectedCity] = useState('');

  const cityOptions = useMemo(() => {
    const uniqueCities = Array.from(new Set(normalizedStores.map((store) => store.city).filter(Boolean)));
    return uniqueCities.sort((a, b) => a.localeCompare(b, 'vi'));
  }, [normalizedStores]);

  const normalizedQuery = useMemo(() => normalizeSearchText(searchTerm), [searchTerm]);

  const filteredStores = useMemo(
    () => normalizedStores.filter((store) => matchesStore(store, normalizedQuery, selectedCity)),
    [normalizedStores, normalizedQuery, selectedCity]
  );

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

  const hasConfiguredStores = normalizedStores.length > 0;
  const hasFilteredStores = filteredStores.length > 0;
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

  const openPreview = (store) => {
    if (!store?.imageUrl) {
      return;
    }

    setPreviewImage({
      src: store.imageUrl,
      alt: store.name ? `Hình ảnh ${store.name}` : 'Hình ảnh cửa hàng',
      title: store.name,
    });
  };

  return (
    <div className="stores-page">
      <div className="stores-shell">
        <section className="stores-hero">
          <div className="stores-hero-copy">
            <h1 className="stores-hero-title">Hệ thống cửa hàng</h1>
            <p className="stores-hero-subtitle">
              Chọn nhanh cửa hàng ở cột thông tin, xem vị trí và bản đồ chi tiết ở cột bên cạnh.
            </p>
          </div>
          {hasConfiguredStores ? (
            <div className="stores-hero-badge">
              <span className="material-symbols-outlined">storefront</span>
              <strong>{normalizedStores.length}</strong>
              <span>cửa hàng</span>
            </div>
          ) : null}
        </section>

        {!hasConfiguredStores ? (
          <section className="stores-empty-panel">
            <div className="stores-empty">
              <span className="material-symbols-outlined">storefront</span>
              <h2>{EMPTY_TITLE}</h2>
              <p>{EMPTY_DESCRIPTION}</p>
            </div>
          </section>
        ) : (
          <div className="stores-content">
            <aside className="stores-sidebar">
              <div className="stores-sidebar-card">
                <div className="stores-sidebar-head">
                  <div>
                    <p className="stores-panel-kicker">Tìm kiếm cửa hàng</p>
                    <h2 className="stores-panel-title">Thông tin cửa hàng</h2>
                  </div>
                  <span className="stores-count-pill">
                    {hasFilteredStores ? filteredStores.length : 0}/{normalizedStores.length}
                  </span>
                </div>

                <div className="stores-search-panel">
                  <label className="stores-search-label" htmlFor="stores-search">
                    Tên cửa hàng, khu vực hoặc địa chỉ
                  </label>
                  <div className="stores-search-wrap">
                    <span className="material-symbols-outlined stores-search-icon">search</span>
                    <input
                      id="stores-search"
                      className="stores-search-input"
                      type="search"
                      placeholder="Ví dụ: Hà Nội, Bát Tràng..."
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                    />
                    {searchTerm ? (
                      <button
                        type="button"
                        className="stores-search-clear"
                        aria-label="Xóa từ khóa tìm kiếm"
                        onClick={() => setSearchTerm('')}
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {cityOptions.length ? (
                  <div className="stores-filter-group">
                    <button
                      type="button"
                      className={`stores-filter-chip${selectedCity ? '' : ' stores-filter-chip--active'}`}
                      onClick={() => setSelectedCity('')}
                    >
                      Toàn quốc
                    </button>
                    {cityOptions.map((city) => (
                      <button
                        key={city}
                        type="button"
                        className={`stores-filter-chip${selectedCity === city ? ' stores-filter-chip--active' : ''}`}
                        onClick={() => setSelectedCity(city)}
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="stores-list">
                  {!hasFilteredStores ? (
                    <div className="stores-empty stores-empty--compact">
                      <span className="material-symbols-outlined">search_off</span>
                      <h2>Không tìm thấy cửa hàng phù hợp</h2>
                      <p>Thử đổi từ khóa hoặc chọn lại khu vực để xem đầy đủ danh sách.</p>
                    </div>
                  ) : (
                    filteredStores.map((store) => {
                      const isActive = activeStore?.id === store.id;
                      const phone = getPrimaryPhone(store);

                      return (
                        <div
                          key={store.id}
                          role="button"
                          tabIndex={0}
                          className={`stores-list-item${isActive ? ' stores-list-item--active' : ''}`}
                          onClick={() => setActiveId(store.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setActiveId(store.id);
                            }
                          }}
                        >
                          <div className="stores-list-item-head">
                            <div className="stores-list-item-copy">
                              <div className="stores-list-item-badges">
                                {store.city ? <span className="stores-chip stores-chip--region">{store.city}</span> : null}
                                {store.tag ? <span className="stores-chip stores-chip--tag">{store.tag}</span> : null}
                              </div>
                              <h3 className="stores-list-item-name">{store.name}</h3>
                            </div>
                            <span className="material-symbols-outlined stores-list-item-arrow">
                              {isActive ? 'radio_button_checked' : 'arrow_outward'}
                            </span>
                          </div>

                          {store.address ? <p className="stores-list-item-address">{store.address}</p> : null}

                          <div className="stores-list-item-meta">
                            {phone ? (
                              <span className="stores-list-item-meta-chip">
                                <span className="material-symbols-outlined">call</span>
                                {phone}
                              </span>
                            ) : null}
                            {store.openingHours ? (
                              <span className="stores-list-item-meta-chip">
                                <span className="material-symbols-outlined">schedule</span>
                                {store.openingHours}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </aside>

            <section className="stores-stage">
              {activeStore ? (
                <div className="stores-stage-card">
                  <div className="stores-stage-summary">
                    <div className="stores-stage-copy">
                      <div className="stores-stage-badges">
                        {activeStore.city ? (
                          <span className="stores-chip stores-chip--region">{activeStore.city}</span>
                        ) : null}
                        {activeStore.tag ? <span className="stores-chip stores-chip--tag">{activeStore.tag}</span> : null}
                      </div>
                      <h2 className="stores-stage-title">{activeStore.name}</h2>
                      <p className="stores-stage-subtitle">
                        {activeRegionLabel || 'Thông tin khu vực đang được cập nhật'}
                      </p>

                      <div className="stores-stage-details">
                        {activeStore.address ? (
                          <DetailItem icon="location_on" label="Địa chỉ" wide>
                            <p>{activeStore.address}</p>
                          </DetailItem>
                        ) : null}

                        {activePhone ? (
                          <DetailItem icon="call" label="Số điện thoại">
                            <a href={buildPhoneLink(activePhone)}>{activePhone}</a>
                          </DetailItem>
                        ) : null}

                        {activeStore.openingHours ? (
                          <DetailItem icon="schedule" label="Giờ mở cửa">
                            <p>{activeStore.openingHours}</p>
                          </DetailItem>
                        ) : null}

                        {activeStore.email ? (
                          <DetailItem icon="mail" label="Email" wide>
                            <a href={buildMailLink(activeStore.email)}>{activeStore.email}</a>
                          </DetailItem>
                        ) : null}

                        {activeStore.note ? (
                          <DetailItem icon="info" label="Ghi chú" wide>
                            <p>{activeStore.note}</p>
                          </DetailItem>
                        ) : null}
                      </div>

                      <div className="stores-stage-actions">
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
                    </div>

                    <div className="stores-stage-media">
                      {activeStore.imageUrl ? (
                        <button
                          type="button"
                          className="stores-stage-media-trigger"
                          onClick={() => openPreview(activeStore)}
                          aria-label={
                            activeStore.name ? `Phóng to ảnh ${activeStore.name}` : 'Phóng to ảnh cửa hàng'
                          }
                        >
                          <Image
                            src={activeStore.imageUrl}
                            alt={activeStore.name ? `Hình ảnh ${activeStore.name}` : 'Hình ảnh cửa hàng'}
                            width={720}
                            height={720}
                            sizes="(max-width: 991px) 100vw, 320px"
                            className="stores-stage-image"
                            unoptimized
                          />
                          <span className="stores-stage-media-zoom">
                            <span className="material-symbols-outlined">zoom_in</span>
                          </span>
                        </button>
                      ) : (
                        <div className="stores-stage-media-fallback">
                          <span className="material-symbols-outlined">storefront</span>
                          <span>Chưa có ảnh cửa hàng</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="stores-map-shell">
                    <div className="stores-map-head">
                      <div>
                        <p className="stores-panel-kicker">Bản đồ cửa hàng</p>
                        <h3 className="stores-map-title">Vị trí {activeStore.name}</h3>
                      </div>
                      {activeStore.mapExternalUrl ? (
                        <a
                          href={activeStore.mapExternalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="stores-map-link"
                        >
                          Mở Google Maps
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
                          <p>Vẫn có thể dùng nút chỉ đường để mở Google Maps ở tab mới.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="stores-empty stores-empty--stage">
                  <span className="material-symbols-outlined">location_off</span>
                  <h2>Chưa có cửa hàng phù hợp</h2>
                  <p>Thử đổi bộ lọc để chọn lại cửa hàng và xem vị trí trên bản đồ.</p>
                </div>
              )}
            </section>
          </div>
        )}
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
        .stores-page{background:radial-gradient(circle at top,rgba(197,160,101,.14),transparent 34%),linear-gradient(180deg,#fdfbf7 0%,#f4ece2 100%)}
        .stores-shell{width:min(100%,1240px);margin:0 auto;padding:.95rem .85rem 5.5rem;display:flex;flex-direction:column;gap:1rem}
        .stores-hero,.stores-sidebar-card,.stores-stage-card,.stores-empty-panel,.stores-empty--stage{border:1px solid rgba(27,54,93,.08);border-radius:28px;background:rgba(255,255,255,.84);box-shadow:0 18px 40px rgba(27,54,93,.08);backdrop-filter:blur(10px)}
        .stores-hero{padding:1rem 1.05rem;display:flex;justify-content:space-between;align-items:flex-start;gap:.9rem;background:linear-gradient(135deg,rgba(255,255,255,.97),rgba(247,241,232,.98)),rgba(255,255,255,.82)}
        .stores-hero-copy{min-width:0}
        .stores-hero-title,.stores-panel-title,.stores-stage-title,.stores-map-title,.stores-empty h2,.stores-map-empty h3{margin:0;font-family:var(--font-display);color:var(--primary)}
        .stores-hero-title{font-size:clamp(1.95rem,7vw,2.65rem);line-height:1.02}
        .stores-hero-subtitle{margin:.55rem 0 0;max-width:42rem;color:rgba(27,54,93,.72);font-size:.96rem;line-height:1.65}
        .stores-hero-badge{flex-shrink:0;display:inline-flex;align-items:center;gap:.5rem;min-height:54px;padding:.75rem .95rem;border-radius:18px;background:rgba(27,54,93,.06);color:var(--primary);font:700 .8rem var(--font-sans);letter-spacing:.08em;text-transform:uppercase}
        .stores-hero-badge .material-symbols-outlined{font-size:1.25rem;color:var(--accent)}
        .stores-hero-badge strong{font-size:1rem;letter-spacing:normal}
        .stores-content{display:grid;gap:1rem}
        .stores-sidebar,.stores-stage{min-width:0}
        .stores-sidebar-card,.stores-stage-card{padding:1rem}
        .stores-sidebar-card,.stores-stage-card,.stores-map-shell{display:flex;flex-direction:column;gap:1rem}
        .stores-sidebar-head,.stores-map-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.85rem}
        .stores-panel-kicker,.stores-search-label,.stores-detail-label{font:700 .7rem var(--font-sans);letter-spacing:.16em;text-transform:uppercase}
        .stores-panel-kicker{margin:0 0 .3rem;color:rgba(27,54,93,.52)}
        .stores-panel-title{font-size:1.45rem;line-height:1.08}
        .stores-count-pill{display:inline-flex;align-items:center;justify-content:center;min-width:64px;min-height:34px;padding:.2rem .8rem;border-radius:999px;background:rgba(197,160,101,.16);color:var(--primary);font:700 .82rem var(--font-sans)}
        .stores-search-panel{padding:.9rem;border:1px solid rgba(27,54,93,.08);border-radius:24px;background:rgba(255,255,255,.9)}
        .stores-search-label{display:block;margin-bottom:.65rem;color:rgba(27,54,93,.58)}
        .stores-search-wrap{position:relative}
        .stores-search-icon{position:absolute;left:.95rem;top:50%;transform:translateY(-50%);color:var(--accent);font-size:1.18rem}
        .stores-search-input{width:100%;height:52px;padding:0 3rem 0 2.9rem;border:1px solid rgba(27,54,93,.12);border-radius:18px;background:#fff;color:var(--primary);font:400 .95rem var(--font-sans);outline:none;transition:border-color .2s ease,box-shadow .2s ease}
        .stores-search-input:focus{border-color:rgba(27,54,93,.34);box-shadow:0 0 0 4px rgba(27,54,93,.08)}
        .stores-search-input::placeholder{color:rgba(27,54,93,.42)}
        .stores-search-clear{position:absolute;right:.55rem;top:50%;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;transform:translateY(-50%);border:none;border-radius:14px;background:transparent;color:rgba(27,54,93,.5);cursor:pointer}
        .stores-search-clear:hover{background:rgba(27,54,93,.06)}
        .stores-filter-group{display:flex;flex-wrap:wrap;gap:.55rem}
        .stores-filter-chip,.stores-chip{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:.2rem .82rem;border:1px solid transparent;border-radius:999px;font:700 .7rem var(--font-sans);letter-spacing:.08em;text-transform:uppercase}
        .stores-filter-chip{background:rgba(27,54,93,.05);color:rgba(27,54,93,.76);cursor:pointer}
        .stores-filter-chip--active{border-color:rgba(197,160,101,.38);background:rgba(197,160,101,.16);color:var(--primary)}
        .stores-chip--region{background:rgba(27,54,93,.08);color:rgba(27,54,93,.8)}
        .stores-chip--tag{background:rgba(197,160,101,.18);color:var(--primary)}
        .stores-list{display:flex;flex-direction:column;gap:.8rem}
        .stores-list-item{padding:.95rem;border:1px solid rgba(27,54,93,.08);border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.97),rgba(249,244,236,.94));cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
        .stores-list-item:hover,.stores-list-item--active{transform:translateY(-1px);border-color:rgba(197,160,101,.42);box-shadow:0 16px 34px rgba(27,54,93,.08)}
        .stores-list-item:focus-visible{outline:3px solid rgba(197,160,101,.28);outline-offset:2px}
        .stores-list-item-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.75rem}
        .stores-list-item-copy{min-width:0}
        .stores-list-item-badges,.stores-stage-badges{display:flex;flex-wrap:wrap;gap:.45rem}
        .stores-list-item-badges{margin-bottom:.5rem}
        .stores-list-item-name{margin:0;font-family:var(--font-display);font-size:1.2rem;line-height:1.15;color:var(--primary);text-wrap:balance}
        .stores-list-item-arrow{flex-shrink:0;color:rgba(27,54,93,.48);font-size:1.2rem}
        .stores-list-item--active .stores-list-item-arrow{color:var(--accent)}
        .stores-list-item-address{margin:.7rem 0 0;color:rgba(27,54,93,.78);font-size:.92rem;line-height:1.6}
        .stores-list-item-meta{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.8rem}
        .stores-list-item-meta-chip{display:inline-flex;align-items:center;gap:.35rem;min-height:30px;padding:.18rem .72rem;border-radius:999px;background:rgba(27,54,93,.05);color:rgba(27,54,93,.8);font:600 .74rem var(--font-sans);line-height:1.3}
        .stores-list-item-meta-chip .material-symbols-outlined{font-size:.92rem;color:var(--accent)}
        .stores-stage-summary{display:grid;gap:1rem}
        .stores-stage-copy{min-width:0}
        .stores-stage-title{margin-top:.75rem;font-size:clamp(1.7rem,4vw,2.25rem);line-height:1.03}
        .stores-stage-subtitle{margin:.55rem 0 0;color:rgba(27,54,93,.68);font-size:.96rem;line-height:1.65}
        .stores-stage-details{margin-top:.95rem;display:grid;gap:.75rem}
        .stores-detail-item{min-width:0;padding:.88rem .9rem;border-radius:22px;background:rgba(27,54,93,.04);border:1px solid rgba(27,54,93,.08)}
        .stores-detail-label{display:flex;align-items:center;gap:.38rem;color:rgba(27,54,93,.48)}
        .stores-detail-label .material-symbols-outlined{font-size:1rem;color:var(--accent)}
        .stores-detail-value{margin-top:.42rem;color:rgba(27,54,93,.84);font-size:.96rem;line-height:1.58;word-break:break-word}
        .stores-detail-value p,.stores-detail-value a{margin:0;color:inherit;text-decoration:none}
        .stores-detail-value a:hover{color:var(--primary);text-decoration:underline}
        .stores-stage-actions{margin-top:.95rem;display:flex;flex-wrap:wrap;gap:.65rem}
        .stores-action-btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;min-height:46px;padding:0 1rem;border:1px solid transparent;border-radius:16px;background:var(--primary);color:#fff;font:700 .76rem var(--font-sans);letter-spacing:.12em;text-transform:uppercase;text-decoration:none;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,background .2s ease,border-color .2s ease}
        .stores-action-btn:hover{transform:translateY(-1px);box-shadow:0 14px 26px rgba(27,54,93,.16)}
        .stores-action-btn--ghost{background:rgba(27,54,93,.04);border-color:rgba(27,54,93,.12);color:var(--primary)}
        .stores-action-btn--ghost:hover{background:rgba(27,54,93,.08)}
        .stores-stage-media{position:relative;min-height:240px;border-radius:26px;overflow:hidden;background:linear-gradient(135deg,rgba(197,160,101,.18),rgba(27,54,93,.12));box-shadow:inset 0 1px 0 rgba(255,255,255,.28)}
        .stores-stage-media-trigger{position:relative;width:100%;height:100%;min-height:240px;border:none;padding:.85rem;background:transparent;cursor:zoom-in}
        .stores-stage-image,.stores-lightbox-image{display:block;width:100%;height:100%;object-fit:contain;object-position:center}
        .stores-stage-media-zoom{position:absolute;right:1rem;bottom:1rem;width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:rgba(255,255,255,.92);color:var(--primary);box-shadow:0 10px 20px rgba(27,54,93,.16)}
        .stores-stage-media-fallback{width:100%;height:100%;min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.55rem;padding:1rem;color:rgba(27,54,93,.72);text-align:center;font:700 .8rem var(--font-sans);letter-spacing:.08em;text-transform:uppercase}
        .stores-stage-media-fallback .material-symbols-outlined{font-size:2rem;color:var(--accent)}
        .stores-map-title{margin-top:.25rem;font-size:1.4rem;line-height:1.1}
        .stores-map-link{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:.2rem .9rem;border-radius:999px;background:rgba(27,54,93,.05);color:var(--primary);font:700 .76rem var(--font-sans);text-decoration:none;white-space:nowrap}
        .stores-map-card{min-height:320px;border-radius:24px;overflow:hidden;border:1px solid rgba(27,54,93,.08);background:linear-gradient(135deg,#e8dece 0%,#d9cdbb 100%)}
        .stores-map-iframe{display:block;width:100%;height:100%;min-height:320px;border:none;filter:saturate(.92) contrast(1.02)}
        .stores-map-empty,.stores-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
        .stores-map-empty{height:100%;min-height:320px;padding:1.5rem;color:rgba(27,54,93,.72)}
        .stores-map-empty .material-symbols-outlined,.stores-empty .material-symbols-outlined{font-size:2.8rem;color:var(--accent)}
        .stores-map-empty h3{margin:.85rem 0 .4rem;font-size:1.35rem}
        .stores-map-empty p{margin:0;line-height:1.58}
        .stores-empty-panel{padding:1rem}
        .stores-empty{min-height:280px;padding:1.75rem 1.2rem;border:1px dashed rgba(27,54,93,.16);border-radius:24px;background:rgba(255,255,255,.65);color:rgba(27,54,93,.72)}
        .stores-empty--compact,.stores-empty--stage{min-height:220px}
        .stores-empty h2{margin:.9rem 0 .45rem;font-size:1.45rem}
        .stores-empty p{margin:0;max-width:32rem;line-height:1.65}
        .stores-lightbox{position:fixed;inset:0;z-index:1400;display:flex;align-items:center;justify-content:center;padding:1rem}
        .stores-lightbox-backdrop{position:absolute;inset:0;border:none;background:rgba(10,20,36,.72);backdrop-filter:blur(8px);cursor:pointer}
        .stores-lightbox-dialog{position:relative;z-index:1;width:min(100%,560px);padding:.9rem;border-radius:26px;background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(247,241,232,.98));box-shadow:0 26px 70px rgba(10,20,36,.28)}
        .stores-lightbox-close{position:absolute;top:.75rem;right:.75rem;width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:999px;background:rgba(27,54,93,.92);color:#fff;cursor:pointer}
        .stores-lightbox-frame{border-radius:20px;overflow:hidden;background:linear-gradient(135deg,rgba(197,160,101,.18),rgba(27,54,93,.12));min-height:280px;display:flex;align-items:center;justify-content:center;padding:1rem}
        .stores-lightbox-image{height:auto;max-height:72vh}
        .stores-lightbox-title{margin:.9rem 0 0;text-align:center;color:var(--primary);font-family:var(--font-display);font-size:1.2rem;line-height:1.3}
        @media (min-width:700px){.stores-shell{padding-left:1.25rem;padding-right:1.25rem}.stores-sidebar-card,.stores-stage-card{padding:1.1rem}.stores-stage-details{grid-template-columns:repeat(2,minmax(0,1fr))}.stores-detail-item--wide{grid-column:1/-1}.stores-map-card,.stores-map-iframe,.stores-map-empty{min-height:380px}}
        @media (min-width:992px){.stores-content{grid-template-columns:minmax(320px,390px) minmax(0,1fr);align-items:start}.stores-sidebar,.stores-stage{position:sticky;top:1.35rem}.stores-list{max-height:calc(100vh - 17rem);overflow-y:auto;padding-right:.2rem}.stores-list::-webkit-scrollbar{width:8px}.stores-list::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(197,160,101,.34)}.stores-stage-summary{grid-template-columns:minmax(0,1.1fr) minmax(260px,320px);align-items:stretch}}
        @media (max-width:640px){.stores-shell{padding:.8rem .75rem 5rem}.stores-hero,.stores-sidebar-card,.stores-stage-card,.stores-empty-panel,.stores-empty--stage{border-radius:24px}.stores-hero{padding:.95rem;flex-direction:column}.stores-hero-badge,.stores-map-link,.stores-action-btn{width:100%;justify-content:center}.stores-panel-title{font-size:1.3rem}.stores-sidebar-head,.stores-map-head,.stores-stage-actions{flex-direction:column}}
        @media (max-width:389px){.stores-hero-title{font-size:1.85rem}.stores-list-item{padding:.88rem}.stores-list-item-name{font-size:1.1rem}.stores-stage-title{font-size:1.6rem}.stores-stage-media,.stores-stage-media-trigger,.stores-stage-media-fallback{min-height:210px}}
      `}</style>
    </div>
  );
}
