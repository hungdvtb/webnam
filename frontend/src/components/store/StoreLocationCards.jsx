import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { normalizePhoneHref } from '../../utils/storeLocations';

const actionBaseClass = 'inline-flex min-h-[56px] w-full items-center justify-between gap-3 rounded-[22px] border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25';

const buttonTextBlock = (label, helper) => (
    <span className="min-w-0 flex-1">
        <span className="block text-sm font-black uppercase tracking-[0.14em]">{label}</span>
        {helper ? (
            <span className="mt-1 block text-xs font-medium normal-case tracking-normal opacity-80">
                {helper}
            </span>
        ) : null}
    </span>
);

const ActionLink = ({ href, icon, label, helper, className, external = false, disabled = false }) => {
    if (disabled || !href) {
        return (
            <span className={`${actionBaseClass} cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400 ${className}`}>
                <span className="material-symbols-outlined text-[22px]">{icon}</span>
                {buttonTextBlock(label, helper)}
                <span className="material-symbols-outlined text-lg">block</span>
            </span>
        );
    }

    return (
        <a
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            className={`${actionBaseClass} ${className}`}
        >
            <span className="material-symbols-outlined text-[22px]">{icon}</span>
            {buttonTextBlock(label, helper)}
            <span className="material-symbols-outlined text-lg">{external ? 'north_east' : 'call'}</span>
        </a>
    );
};

const ActionButton = ({ icon, label, helper, className, onClick, expanded = false, disabled = false }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-expanded={disabled ? undefined : expanded}
        className={`${actionBaseClass} ${disabled ? 'cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400' : className}`}
    >
        <span className="material-symbols-outlined text-[22px]">{icon}</span>
        {buttonTextBlock(label, helper)}
        <span className="material-symbols-outlined text-lg">{disabled ? 'block' : (expanded ? 'remove' : 'add')}</span>
    </button>
);

const InfoRow = ({ icon, children }) => (
    <div className="flex items-start gap-3 rounded-2xl bg-background-light/80 px-3.5 py-3">
        <span className="material-symbols-outlined mt-0.5 text-[20px] text-primary">{icon}</span>
        <div className="min-w-0 flex-1 text-sm leading-6 text-stone-700">{children}</div>
    </div>
);

const StoreLocationCard = ({ store, mode = 'page', highlighted = false, sitePhone = '' }) => {
    const [detailsOpen, setDetailsOpen] = useState(Boolean(highlighted && mode === 'page'));
    const [mapOpen, setMapOpen] = useState(false);

    const fallbackPhoneHref = normalizePhoneHref(sitePhone);
    const callHref = store.phoneHref || fallbackPhoneHref;
    const callLabel = store.hotline || sitePhone || 'Đang cập nhật số gọi';
    const mapsHref = store.directionsUrl || store.mapsSearchUrl;
    const hasMap = Boolean(store.mapEmbedUrl || mapsHref);
    const detailHref = `/stores#${store.anchorId}`;

    useEffect(() => {
        if (highlighted && mode === 'page') {
            setDetailsOpen(true);
        }
    }, [highlighted, mode]);

    return (
        <article
            id={store.anchorId}
            className={`scroll-mt-28 rounded-[28px] border bg-white p-4 shadow-[0_24px_70px_-42px_rgba(27,54,93,0.42)] transition md:p-5 ${
                highlighted ? 'border-primary/35 ring-2 ring-primary/10' : 'border-gold/15'
            }`}
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-primary">
                                Hệ thống cửa hàng
                            </span>
                            <h3 className="mt-3 text-[1.35rem] font-black leading-tight tracking-tight text-primary">
                                {store.name}
                            </h3>
                        </div>

                        <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">
                            Đang phục vụ
                        </span>
                    </div>

                    <div className="space-y-2.5">
                        {store.address ? (
                            <InfoRow icon="location_on">
                                <p className="font-semibold text-umber">{store.address}</p>
                            </InfoRow>
                        ) : null}

                        <InfoRow icon="call">
                            {callHref ? (
                                <a href={callHref} className="font-semibold text-umber underline decoration-primary/30 underline-offset-4">
                                    {callLabel}
                                </a>
                            ) : (
                                <p className="font-semibold text-stone-500">{callLabel}</p>
                            )}
                        </InfoRow>

                        {store.openingHours ? (
                            <InfoRow icon="schedule">
                                <p className="font-medium text-stone-700">{store.openingHours}</p>
                            </InfoRow>
                        ) : null}
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    <ActionLink
                        href={callHref}
                        icon="call"
                        label="Gọi"
                        helper={store.hotline ? 'Bấm để gọi ngay' : 'Dùng số hotline chung'}
                        className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-300 hover:bg-emerald-100"
                        disabled={!callHref}
                    />

                    <ActionLink
                        href={mapsHref}
                        icon="navigation"
                        label="Chỉ đường"
                        helper="Mở Google Maps dẫn đường"
                        className="border-primary/15 bg-primary text-white hover:brightness-95"
                        external
                        disabled={!mapsHref}
                    />

                    {mode === 'page' ? (
                        <ActionButton
                            icon="info"
                            label="Chi tiết"
                            helper={detailsOpen ? 'Thu gọn thông tin thêm' : 'Mở nhanh ghi chú và ảnh'}
                            className="border-gold/20 bg-background-light text-umber hover:border-gold/35 hover:bg-[#f2e8dc]"
                            expanded={detailsOpen}
                            onClick={() => setDetailsOpen((previous) => !previous)}
                        />
                    ) : (
                        <Link
                            to={detailHref}
                            className={`${actionBaseClass} border-gold/20 bg-background-light text-umber hover:border-gold/35 hover:bg-[#f2e8dc]`}
                        >
                            <span className="material-symbols-outlined text-[22px]">info</span>
                            {buttonTextBlock('Chi tiết', 'Mở trang cửa hàng đầy đủ')}
                            <span className="material-symbols-outlined text-lg">arrow_forward</span>
                        </Link>
                    )}

                    <ActionButton
                        icon="map"
                        label="Bản đồ"
                        helper={mapOpen ? 'Ẩn bản đồ thu gọn' : 'Xem nhanh ngay trong trang'}
                        className="border-stone-200 bg-white text-stone-800 hover:border-primary/25 hover:bg-primary/[0.03]"
                        expanded={mapOpen}
                        onClick={() => setMapOpen((previous) => !previous)}
                        disabled={!hasMap}
                    />
                </div>

                {detailsOpen ? (
                    <div className="rounded-[24px] border border-gold/15 bg-background-light/90 p-4">
                        <div className="flex items-start gap-4">
                            {store.imageUrl ? (
                                <img
                                    src={store.imageUrl}
                                    alt={store.name}
                                    loading="lazy"
                                    className="h-20 w-20 shrink-0 rounded-2xl object-cover"
                                />
                            ) : (
                                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                                    <span className="material-symbols-outlined text-[28px]">storefront</span>
                                </div>
                            )}

                            <div className="min-w-0 flex-1 space-y-2">
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">
                                    Thông tin thêm
                                </p>
                                <p className="text-sm leading-6 text-stone-700">
                                    {store.note || 'Showroom đang mở cho khách ghé trực tiếp. Bạn có thể gọi trước để được hỗ trợ nhanh hơn.'}
                                </p>
                                {store.email ? (
                                    <a href={`mailto:${store.email}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary underline decoration-primary/30 underline-offset-4">
                                        <span className="material-symbols-outlined text-[18px]">mail</span>
                                        {store.email}
                                    </a>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}

                {mapOpen ? (
                    <div className="overflow-hidden rounded-[24px] border border-stone-200 bg-white">
                        <div className="border-b border-stone-200 px-4 py-3">
                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">
                                Bản đồ thu gọn
                            </p>
                            <p className="mt-1 text-sm leading-6 text-stone-500">
                                {store.address || 'Mở Google Maps để xem vị trí chi tiết hơn.'}
                            </p>
                        </div>

                        {store.mapEmbedUrl ? (
                            <iframe
                                title={`Bản đồ ${store.name}`}
                                src={store.mapEmbedUrl}
                                loading="lazy"
                                referrerPolicy="no-referrer-when-downgrade"
                                className="h-56 w-full border-0"
                            />
                        ) : null}

                        {mapsHref ? (
                            <a
                                href={mapsHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex w-full items-center justify-center gap-2 border-t border-stone-200 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-primary transition hover:bg-primary/[0.03]"
                            >
                                <span className="material-symbols-outlined text-[18px]">north_east</span>
                                Mở bản đồ lớn
                            </a>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </article>
    );
};

const StoreLocationsEmptyState = ({ sitePhone = '' }) => {
    const fallbackPhoneHref = normalizePhoneHref(sitePhone);

    return (
        <div className="rounded-[28px] border border-dashed border-gold/30 bg-white p-5 text-center shadow-[0_24px_70px_-42px_rgba(27,54,93,0.42)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/8 text-primary">
                <span className="material-symbols-outlined text-[30px]">storefront</span>
            </div>
            <h3 className="mt-4 text-xl font-black tracking-tight text-primary">Đang cập nhật danh sách cửa hàng</h3>
            <p className="mt-2 text-sm leading-6 text-stone-600">
                Thông tin showroom sẽ được bổ sung sớm. Nếu cần hỗ trợ ngay, bạn có thể gọi hotline để được hướng dẫn.
            </p>
            {fallbackPhoneHref ? (
                <a
                    href={fallbackPhoneHref}
                    className="mt-4 inline-flex min-h-[52px] items-center justify-center rounded-[20px] bg-primary px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white transition hover:brightness-95"
                >
                    Gọi hotline
                </a>
            ) : null}
        </div>
    );
};

const StoreLocationCards = ({ stores = [], mode = 'page', limit, sitePhone = '' }) => {
    const location = useLocation();
    const highlightedStoreId = location.pathname === '/stores'
        ? decodeURIComponent(location.hash.replace(/^#/, '').trim())
        : '';

    const visibleStores = typeof limit === 'number' ? stores.slice(0, limit) : stores;

    if (!visibleStores.length) {
        return <StoreLocationsEmptyState sitePhone={sitePhone} />;
    }

    return (
        <div className="grid grid-cols-1 gap-4">
            {visibleStores.map((store) => (
                <StoreLocationCard
                    key={store.id || store.anchorId}
                    store={store}
                    mode={mode}
                    highlighted={highlightedStoreId === store.anchorId}
                    sitePhone={sitePhone}
                />
            ))}
        </div>
    );
};

export default StoreLocationCards;
