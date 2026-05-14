import React, { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

const envTrackingSettings = {
    fb_pixel_id: import.meta.env.VITE_FB_PIXEL_ID || '',
    fb_pixel_active: Boolean(import.meta.env.VITE_FB_PIXEL_ID),
    ga_id: import.meta.env.VITE_GA4_ID || '',
    ga_active: Boolean(import.meta.env.VITE_GA4_ID),
    tt_pixel_id: import.meta.env.VITE_TIKTOK_PIXEL_ID || '',
    tt_pixel_active: Boolean(import.meta.env.VITE_TIKTOK_PIXEL_ID),
};

const isTrackingEnabled = (value) => {
    if (value === true || value === 1 || value === '1') return true;
    if (typeof value !== 'string') return false;

    return ['true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const normalizeTrackingId = (value) => String(value ?? '').trim();

const parseTrackingList = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const uniqueTrackingIds = (ids) => Array.from(new Set(
    ids.map((id) => normalizeTrackingId(id)).filter(Boolean)
));

const getActiveTrackingIds = (items, legacyId, legacyActive) => {
    const parsedItems = parseTrackingList(items);

    if (parsedItems.length > 0) {
        return uniqueTrackingIds(parsedItems
            .filter((item) => {
                if (typeof item !== 'object' || item === null) return true;
                return item.is_active === undefined
                    ? isTrackingEnabled(item.active ?? true)
                    : isTrackingEnabled(item.is_active);
            })
            .map((item) => {
                if (typeof item !== 'object' || item === null) return item;

                return item.pixel_id
                    ?? item.tracking_id
                    ?? item.measurement_id
                    ?? item.id_value
                    ?? item.value
                    ?? '';
            }));
    }

    return isTrackingEnabled(legacyActive) ? uniqueTrackingIds([legacyId]) : [];
};

const getActiveGoogleAdsConversions = (items) => {
    const seen = new Set();

    return parseTrackingList(items)
        .filter((item) => item && typeof item === 'object')
        .filter((item) => (
            item.is_active === undefined
                ? isTrackingEnabled(item.active ?? true)
                : isTrackingEnabled(item.is_active)
        ))
        .map((item, index) => ({
            id: String(item.id || `google-ads-conversion-${index + 1}`),
            name: String(item.name || '').trim(),
            conversion_id: normalizeTrackingId(
                item.conversion_id
                ?? item.google_ads_conversion_id
                ?? item.pixel_id
                ?? item.tracking_id
                ?? item.id_value
                ?? item.value
                ?? ''
            ),
            conversion_label: String(
                item.conversion_label
                ?? item.google_ads_conversion_label
                ?? item.label_id
                ?? ''
            ).trim(),
        }))
        .filter((item) => item.conversion_id)
        .filter((item) => {
            const key = `${item.conversion_id}/${item.conversion_label}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

const ensureGtag = (bootstrapId, configIds, googleAdsConversions) => {
    if (!bootstrapId) return;

    if (!window.gtag) {
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(bootstrapId)}`;
        document.head.appendChild(script);

        window.dataLayer = window.dataLayer || [];
        window.gtag = function gtag() { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
    }

    window.__WEBGOM_GTAG_CONFIGURED_IDS__ = window.__WEBGOM_GTAG_CONFIGURED_IDS__ || {};
    configIds.forEach((id) => {
        if (!id || window.__WEBGOM_GTAG_CONFIGURED_IDS__[id]) return;
        window.gtag('config', id);
        window.__WEBGOM_GTAG_CONFIGURED_IDS__[id] = true;
    });

    window.__WEBGOM_GOOGLE_ADS_CONVERSIONS__ = googleAdsConversions;
};

const initFBPixel = (ids) => {
    if (ids.length === 0) return;

    if (!window.fbq) {
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
    }

    window.__WEBGOM_FB_PIXEL_IDS__ = window.__WEBGOM_FB_PIXEL_IDS__ || {};
    ids.forEach((id) => {
        if (window.__WEBGOM_FB_PIXEL_IDS__[id]) return;
        window.fbq('init', id);
        window.__WEBGOM_FB_PIXEL_IDS__[id] = true;
    });
    window.fbq('track', 'PageView');
};

const initTikTokPixel = (ids) => {
    if (ids.length === 0) return;

    if (!window.ttq) {
        !function (w, d, t) {
            w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._iq||[],n=0;n<e.length;n++)if(e[n][0]===t)return e[n];return ttq};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},n=n||{};ttq._o[e]=n;var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
        }(window, document, 'ttq');
    }

    window.__WEBGOM_TIKTOK_PIXEL_IDS__ = window.__WEBGOM_TIKTOK_PIXEL_IDS__ || {};
    ids.forEach((id) => {
        if (window.__WEBGOM_TIKTOK_PIXEL_IDS__[id]) return;
        window.ttq.load(id);
        window.__WEBGOM_TIKTOK_PIXEL_IDS__[id] = true;
    });
    window.ttq.page();
};

const resolveTrackingState = (settings) => {
    const source = settings === undefined ? envTrackingSettings : settings;
    if (!source) {
        return null;
    }

    const fbPixelIds = getActiveTrackingIds(source.fb_pixels, source.fb_pixel_id, source.fb_pixel_active);
    const gaTrackingIds = getActiveTrackingIds(source.ga_trackings, source.ga_id, source.ga_active);
    const ttPixelIds = getActiveTrackingIds(source.tt_pixels, source.tt_pixel_id, source.tt_pixel_active);
    const googleAdsConversions = getActiveGoogleAdsConversions(source.google_ads_conversions);
    const googleAdsConversionIds = uniqueTrackingIds(googleAdsConversions.map((item) => item.conversion_id));

    return {
        fbPixelIds,
        gaTrackingIds,
        googleAdsConversions,
        googleAdsConversionIds,
        ttPixelIds,
        gtagBootstrapId: gaTrackingIds[0] || googleAdsConversionIds[0] || '',
    };
};

const getGoogleAdsConversions = () => {
    const conversions = Array.isArray(window.__WEBGOM_GOOGLE_ADS_CONVERSIONS__)
        ? window.__WEBGOM_GOOGLE_ADS_CONVERSIONS__
        : [];

    return conversions.filter((item) => item?.conversion_id && item?.conversion_label);
};

const TrackingScripts = ({ settings }) => {
    const location = useLocation();
    const trackingState = useMemo(() => resolveTrackingState(settings), [settings]);

    useEffect(() => {
        if (!trackingState) return;

        const gtagConfigIds = uniqueTrackingIds([
            ...trackingState.gaTrackingIds,
            ...trackingState.googleAdsConversionIds,
        ]);

        ensureGtag(
            trackingState.gtagBootstrapId,
            gtagConfigIds,
            trackingState.googleAdsConversions
        );
        initFBPixel(trackingState.fbPixelIds);
        initTikTokPixel(trackingState.ttPixelIds);
    }, [trackingState]);

    useEffect(() => {
        if (!trackingState) return;

        const path = location.pathname + location.search;

        if (window.gtag && trackingState.gaTrackingIds.length > 0) {
            window.gtag('event', 'page_view', { page_path: path });
        }

        if (window.fbq && trackingState.fbPixelIds.length > 0) {
            window.fbq('track', 'PageView', { page: path });
        }

        if (window.ttq && trackingState.ttPixelIds.length > 0) {
            window.ttq.page();
        }
    }, [location, trackingState]);

    return null;
};

export const trackAddToCart = (product, quantity = 1) => {
    if (window.gtag) {
        window.gtag('event', 'add_to_cart', {
            currency: 'VND',
            value: product.price * quantity,
            items: [{
                item_id: product.id || product.sku,
                item_name: product.name,
                price: product.price,
                quantity,
            }],
        });
    }

    if (window.fbq) {
        window.fbq('track', 'AddToCart', {
            content_ids: [product.id || product.sku],
            content_type: 'product',
            value: product.price * quantity,
            currency: 'VND',
        });
    }

    if (window.ttq) {
        window.ttq.track('AddToCart', {
            contents: [{
                content_id: product.id || product.sku,
                content_type: 'product',
                content_name: product.name,
                quantity,
                price: product.price,
            }],
            value: product.price * quantity,
            currency: 'VND',
        });
    }
};

export const trackInitiateCheckout = (cartItems, totalValue) => {
    if (window.fbq) window.fbq('track', 'InitiateCheckout', { value: totalValue, currency: 'VND' });
    if (window.gtag) window.gtag('event', 'begin_checkout', { currency: 'VND', value: totalValue });
    if (window.ttq) window.ttq.track('InitiateCheckout');
};

export const trackPurchase = (orderId, totalValue) => {
    const transactionId = String(orderId || '').trim();
    const value = Math.max(0, Number(totalValue || 0) || 0);

    if (window.fbq) window.fbq('track', 'Purchase', { value, currency: 'VND' });
    if (window.gtag) {
        window.gtag('event', 'purchase', { transaction_id: transactionId, currency: 'VND', value });
        getGoogleAdsConversions().forEach((conversion) => {
            window.gtag('event', 'conversion', {
                send_to: `${conversion.conversion_id}/${conversion.conversion_label}`,
                value,
                currency: 'VND',
                transaction_id: transactionId,
            });
        });
    }
    if (window.ttq) window.ttq.track('CompletePayment', { value, currency: 'VND' });
};

export const trackLead = (leadCategory) => {
    if (window.fbq) window.fbq('track', 'Lead', { content_category: leadCategory });
    if (window.gtag) window.gtag('event', 'generate_lead', { currency: 'VND', value: 0 });
    if (window.ttq) window.ttq.track('SubmitForm');
};

export default TrackingScripts;
