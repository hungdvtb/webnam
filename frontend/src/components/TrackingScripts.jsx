import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Mẫu tích hợp tracking pixels (Facebook Pixel, GA4, TikTok).
 * Thông thường các mã ID này nên đến từ Database (SiteSettings) hoặc .env
 * Đây là mock implementation để thoả mãn yêu cầu.
 */
const TRACKING_IDS = {
    fbPixel: import.meta.env.VITE_FB_PIXEL_ID || '1234567890',
    ga4: import.meta.env.VITE_GA4_ID || 'G-XXXXXXXXXX',
    tiktok: import.meta.env.VITE_TIKTOK_PIXEL_ID || 'CLXXXXXXXXXXXX',
};

// ── Google Analytics 4 ──
const initGA4 = (id) => {
    if (window.gtag) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id);
};

// ── Facebook Pixel ──
const initFBPixel = (id) => {
    if (window.fbq) return;
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', id);
    window.fbq('track', 'PageView');
};

// ── TikTok Pixel ──
const initTikTokPixel = (id) => {
    if (window.ttq) return;
    !function (w, d, t) {
        w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._iq||[],n=0;n<e.length;n++)if(e[n][0]===t)return e[n];return ttq};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
        ttq.load(id);
        ttq.page();
    }(window, document, 'ttq');
};

const TrackingScripts = () => {
    const location = useLocation();

    // Initialize scripts ONCE mount
    useEffect(() => {
        if (TRACKING_IDS.ga4) initGA4(TRACKING_IDS.ga4);
        if (TRACKING_IDS.fbPixel) initFBPixel(TRACKING_IDS.fbPixel);
        if (TRACKING_IDS.tiktok) initTikTokPixel(TRACKING_IDS.tiktok);
    }, []);

    // Track route changes (PageViews)
    useEffect(() => {
        const path = location.pathname + location.search;

        // GA4
        if (window.gtag && TRACKING_IDS.ga4) {
            window.gtag('event', 'page_view', { page_path: path });
        }

        // Facebook Pixel
        if (window.fbq && TRACKING_IDS.fbPixel) {
            window.fbq('track', 'PageView', { page: path });
        }

        // TikTok Pixel
        if (window.ttq && TRACKING_IDS.tiktok) {
            window.ttq.page();
        }

    }, [location]);

    return null; // This component doesn't render anything
};

// ---- Standardized event tracking helpers to be used inside UI ----

export const trackAddToCart = (product, quantity = 1) => {
    // GA4
    if (window.gtag) {
        window.gtag('event', 'add_to_cart', {
            currency: 'VND',
            value: product.price * quantity,
            items: [{
                item_id: product.id || product.sku,
                item_name: product.name,
                price: product.price,
                quantity: quantity
            }]
        });
    }

    // FB Pixel
    if (window.fbq) {
        window.fbq('track', 'AddToCart', {
            content_ids: [product.id || product.sku],
            content_type: 'product',
            value: product.price * quantity,
            currency: 'VND'
        });
    }

    // TikTok
    if (window.ttq) {
        window.ttq.track('AddToCart', {
            contents: [{
                content_id: product.id || product.sku,
                content_type: 'product',
                content_name: product.name,
                quantity: quantity,
                price: product.price
            }],
            value: product.price * quantity,
            currency: 'VND'
        });
    }
};

export const trackInitiateCheckout = (cartItems, totalValue) => {
    if (window.fbq) window.fbq('track', 'InitiateCheckout', { value: totalValue, currency: 'VND' });
    if (window.gtag) window.gtag('event', 'begin_checkout', { currency: 'VND', value: totalValue });
    if (window.ttq) window.ttq.track('InitiateCheckout');
};

export const trackPurchase = (orderId, totalValue, items) => {
    if (window.fbq) window.fbq('track', 'Purchase', { value: totalValue, currency: 'VND' });
    if (window.gtag) window.gtag('event', 'purchase', { transaction_id: orderId, currency: 'VND', value: totalValue });
    if (window.ttq) window.ttq.track('CompletePayment', { value: totalValue, currency: 'VND' });
};

export const trackLead = (leadCategory) => {
    if (window.fbq) window.fbq('track', 'Lead', { content_category: leadCategory });
    if (window.gtag) window.gtag('event', 'generate_lead', { currency: 'VND', value: 0 });
    if (window.ttq) window.ttq.track('SubmitForm');
};

export default TrackingScripts;
