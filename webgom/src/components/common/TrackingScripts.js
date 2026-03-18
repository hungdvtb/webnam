"use client";

import React from 'react';

const TrackingScripts = ({ settings }) => {
    if (!settings) return null;

    const {
        fb_pixel_id, fb_pixel_active,
        ga_id, ga_active,
        tt_pixel_id, tt_pixel_active
    } = settings;

    return (
        <>
            {/* Facebook Pixel */}
            {fb_pixel_active === "1" && fb_pixel_id && (
                <script dangerouslySetInnerHTML={{ __html: `
                    !function(f,b,e,v,n,t,s)
                    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                    n.queue=[];t=b.createElement(e);t.async=!0;
                    t.src=v;s=b.getElementsByTagName(e)[0];
                    s.parentNode.insertBefore(t,s)}(window, document,'script',
                    'https://connect.facebook.net/en_US/fbevents.js');
                    fbq('init', '${fb_pixel_id}');
                    fbq('track', 'PageView');
                `}} />
            )}

            {/* Google Analytics */}
            {ga_active === "1" && ga_id && (
                <>
                    <script async src={`https://www.googletagmanager.com/gtag/js?id=${ga_id}`}></script>
                    <script dangerouslySetInnerHTML={{ __html: `
                        window.dataLayer = window.dataLayer || [];
                        function gtag(){dataLayer.push(arguments);}
                        gtag('js', new Date());
                        gtag('config', '${ga_id}');
                    `}} />
                </>
            )}

            {/* TikTok Pixel */}
            {tt_pixel_active === "1" && tt_pixel_id && (
                <script dangerouslySetInnerHTML={{ __html: `
                    !function (w, d, t) {
                        w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","detach","onboard","addTag"],ttq.setAndDefer=function(t,e){t.instance=e[t.instance]};for(var e=0;e<ttq.methods.length;e++)ttq.setAndDefer(ttq,ttq.methods[e]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=i+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
                        ttq.load('${tt_pixel_id}');
                        ttq.page();
                    }(window, document, 'ttq');
                `}} />
            )}
        </>
    );
};

export default TrackingScripts;
