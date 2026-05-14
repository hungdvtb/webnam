/* eslint-disable @next/next/no-img-element */

import React from 'react';

const isTrackingEnabled = (value) => {
    if (value === true || value === 1 || value === "1") return true;
    if (typeof value !== "string") return false;

    return ["true", "yes", "on"].includes(value.trim().toLowerCase());
};

const normalizeTrackingId = (value) => String(value ?? "").trim();

const parseTrackingList = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];

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
                if (typeof item !== "object" || item === null) return true;
                return item.is_active === undefined
                    ? isTrackingEnabled(item.active ?? true)
                    : isTrackingEnabled(item.is_active);
            })
            .map((item) => {
                if (typeof item !== "object" || item === null) return item;

                return item.pixel_id
                    ?? item.tracking_id
                    ?? item.measurement_id
                    ?? item.id_value
                    ?? item.value
                    ?? "";
            }));
    }

    return isTrackingEnabled(legacyActive) ? uniqueTrackingIds([legacyId]) : [];
};

const TrackingScripts = ({ settings }) => {
    if (!settings) return null;

    const {
        fb_pixel_id, fb_pixel_active,
        ga_id, ga_active,
        tt_pixel_id, tt_pixel_active,
        fb_pixels, ga_trackings, tt_pixels
    } = settings;

    const fbPixelIds = getActiveTrackingIds(fb_pixels, fb_pixel_id, fb_pixel_active);
    const gaTrackingIds = getActiveTrackingIds(ga_trackings, ga_id, ga_active);
    const ttPixelIds = getActiveTrackingIds(tt_pixels, tt_pixel_id, tt_pixel_active);

    return (
        <>
            {/* Facebook Pixel */}
            {fbPixelIds.length > 0 && (
                <>
                    <script dangerouslySetInnerHTML={{ __html: `
                    !function(f,b,e,v,n,t,s)
                    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                    n.queue=[];t=b.createElement(e);t.async=!0;
                    t.src=v;s=b.getElementsByTagName(e)[0];
                    s.parentNode.insertBefore(t,s)}(window, document,'script',
                    'https://connect.facebook.net/en_US/fbevents.js');
                    ${fbPixelIds.map((id) => `fbq('init', ${JSON.stringify(id)});`).join("\n                    ")}
                    fbq('track', 'PageView');
                    `}} />
                    {fbPixelIds.map((id) => (
                        <noscript key={`fb-noscript-${id}`}>
                            <img
                                height="1"
                                width="1"
                                style={{ display: "none" }}
                                src={`https://www.facebook.com/tr?id=${encodeURIComponent(id)}&ev=PageView&noscript=1`}
                                alt=""
                            />
                        </noscript>
                    ))}
                </>
            )}

            {/* Google Analytics */}
            {gaTrackingIds.length > 0 && (
                <>
                    <script async src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaTrackingIds[0])}`}></script>
                    <script dangerouslySetInnerHTML={{ __html: `
                        window.dataLayer = window.dataLayer || [];
                        function gtag(){dataLayer.push(arguments);}
                        gtag('js', new Date());
                        ${gaTrackingIds.map((id) => `gtag('config', ${JSON.stringify(id)});`).join("\n                        ")}
                    `}} />
                </>
            )}

            {/* TikTok Pixel */}
            {ttPixelIds.length > 0 && (
                <script dangerouslySetInnerHTML={{ __html: `
                    !function (w, d, t) {
                        w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","detach","onboard","addTag"],ttq.setAndDefer=function(t,e){t.instance=e[t.instance]};for(var e=0;e<ttq.methods.length;e++)ttq.setAndDefer(ttq,ttq.methods[e]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=i+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
                        ${ttPixelIds.map((id) => `ttq.load(${JSON.stringify(id)});`).join("\n                        ")}
                        ttq.page();
                    }(window, document, 'ttq');
                `}} />
            )}
        </>
    );
};

export default TrackingScripts;
