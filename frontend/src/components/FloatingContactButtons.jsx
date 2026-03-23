import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cmsApi } from '../services/api';
import floatingContactConfig from '../config/floatingContact';

const iconStyle = {
    width: 24,
    height: 24,
    display: 'block',
};

const containerBaseStyle = {
    position: 'fixed',
    right: '20px',
    bottom: '100px',
    zIndex: 9998,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    pointerEvents: 'auto',
};

const buttonBaseStyle = {
    width: '54px',
    height: '54px',
    borderRadius: '999px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.22)',
    boxShadow: '0 14px 28px rgba(15, 23, 42, 0.24)',
    transition: 'transform 180ms ease, box-shadow 180ms ease, filter 180ms ease',
    textDecoration: 'none',
    WebkitTapHighlightColor: 'transparent',
};

const normalizePhoneHref = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return '';
    }

    if (trimmed.toLowerCase().startsWith('tel:')) {
        return trimmed;
    }

    const sanitized = trimmed.replace(/[^\d+]/g, '');
    return sanitized ? `tel:${sanitized}` : '';
};

const normalizeExternalUrl = (value, provider) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return '';
    }

    if (/^(https?:|mailto:|tel:|zalo:)/i.test(trimmed)) {
        return trimmed;
    }

    if (trimmed.startsWith('//')) {
        return `https:${trimmed}`;
    }

    if (provider === 'messenger') {
        const normalized = trimmed
            .replace(/^https?:\/\/(www\.)?facebook\.com\//i, '')
            .replace(/^https?:\/\/m\.me\//i, '')
            .replace(/^https?:\/\/(www\.)?messenger\.com\/t\//i, '')
            .replace(/^\/+/, '')
            .split(/[/?#]/)[0]
            .trim();

        if (normalized) {
            return `https://m.me/${normalized}`;
        }
    }

    if (provider === 'zalo') {
        const zaloId = trimmed.replace(/[^\d]/g, '');
        if (zaloId) {
            return `https://zalo.me/${zaloId}`;
        }
    }

    return `https://${trimmed.replace(/^\/+/, '')}`;
};

const getFirstAvailablePhone = (settings) => {
    if (!settings || typeof settings !== 'object') {
        return floatingContactConfig.phone || '';
    }

    const firstStore = Array.isArray(settings.store_locations)
        ? settings.store_locations.find((item) => item?.is_active !== false)
        : null;

    return (
        settings.contact_phone ||
        settings.footer_hotline ||
        settings.quote_store_phone ||
        firstStore?.hotline ||
        firstStore?.phone ||
        floatingContactConfig.phone ||
        ''
    );
};

const buildContactLinks = (settings) => {
    const phoneSource = getFirstAvailablePhone(settings);
    const phone = normalizePhoneHref(phoneSource);
    const zaloSource = settings?.zalo_link || floatingContactConfig.zalo || phoneSource;
    const messengerSource = settings?.messenger_link || settings?.facebook_link || floatingContactConfig.messenger;

    return {
        phone,
        zalo: normalizeExternalUrl(zaloSource, 'zalo'),
        messenger: normalizeExternalUrl(messengerSource, 'messenger'),
    };
};

const ZaloIcon = () => (
    <svg viewBox="0 0 24 24" style={iconStyle} fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.25" fill="currentColor" fillOpacity="0.12" />
        <path d="M7 8H17L7.8 16H17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const MessengerIcon = () => (
    <svg viewBox="0 0 24 24" style={iconStyle} fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.907 1.434 5.503 3.683 7.197V22l3.38-1.856c.903.25 1.86.383 2.937.383 5.523 0 10-4.145 10-9.243C22 6.145 17.523 2 12 2zm1.039 12.458l-2.545-2.715L5.5 14.458l5.474-5.81 2.608 2.715L18.5 8.148l-5.461 6.31z" />
    </svg>
);

const PhoneIcon = () => (
    <svg viewBox="0 0 24 24" style={iconStyle} fill="none" aria-hidden="true">
        <path
            d="M6.599 4h2.364a1.5 1.5 0 0 1 1.478 1.243l.553 3.064a1.5 1.5 0 0 1-.811 1.602l-1.649.785a13.873 13.873 0 0 0 4.772 4.772l.785-1.649a1.5 1.5 0 0 1 1.602-.811l3.064.553A1.5 1.5 0 0 1 20 15.037V17.4a2 2 0 0 1-2.175 1.994C10.19 18.907 5.093 13.81 4.606 6.175A2 2 0 0 1 6.599 4Z"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

const FloatingContactButton = ({ button, compact }) => {
    const [isActive, setIsActive] = useState(false);
    const style = {
        ...buttonBaseStyle,
        width: compact ? '50px' : buttonBaseStyle.width,
        height: compact ? '50px' : buttonBaseStyle.height,
        background: button.background,
        boxShadow: isActive ? button.activeShadow : buttonBaseStyle.boxShadow,
        transform: isActive ? 'translateY(-2px) scale(1.08)' : 'translateY(0) scale(1)',
        filter: isActive ? 'saturate(1.03)' : 'none',
    };

    return (
        <a
            href={button.href}
            target={button.isPhone ? undefined : '_blank'}
            rel={button.isPhone ? undefined : 'noopener noreferrer'}
            aria-label={button.label}
            title={button.label}
            style={style}
            onMouseEnter={() => setIsActive(true)}
            onMouseLeave={() => setIsActive(false)}
            onFocus={() => setIsActive(true)}
            onBlur={() => setIsActive(false)}
        >
            {button.icon}
        </a>
    );
};

const FloatingContactButtons = () => {
    const location = useLocation();
    const [contactLinks, setContactLinks] = useState(() => buildContactLinks({}));
    const [isCompact, setIsCompact] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 640 : false));

    const isAdminRoute = location.pathname.toLowerCase().startsWith('/admin');

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const handleResize = () => {
            setIsCompact(window.innerWidth < 640);
        };

        handleResize();
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    useEffect(() => {
        if (isAdminRoute) {
            return undefined;
        }

        let ignore = false;

        const loadSettings = async () => {
            try {
                const response = await cmsApi.settings.get();
                const settings = response.data || {};

                if (!ignore) {
                    setContactLinks(buildContactLinks(settings));
                }
            } catch (error) {
                if (!ignore) {
                    console.error('Error loading floating contact settings', error);
                    setContactLinks(buildContactLinks({}));
                }
            }
        };

        loadSettings();

        return () => {
            ignore = true;
        };
    }, [isAdminRoute]);

    if (isAdminRoute) {
        return null;
    }

    const buttons = [
        contactLinks.zalo
            ? {
                key: 'zalo',
                href: contactLinks.zalo,
                label: 'Chat Zalo',
                icon: <ZaloIcon />,
                background: '#0a88ff',
                activeShadow: '0 18px 36px rgba(10, 136, 255, 0.42), 0 0 0 4px rgba(186, 230, 253, 0.72)',
                isPhone: false,
            }
            : null,
        contactLinks.messenger
            ? {
                key: 'messenger',
                href: contactLinks.messenger,
                label: 'Chat Messenger',
                icon: <MessengerIcon />,
                background: 'linear-gradient(135deg, #19c6ff 0%, #0a7cff 52%, #7a4dff 100%)',
                activeShadow: '0 18px 36px rgba(14, 116, 255, 0.42), 0 0 0 4px rgba(191, 219, 254, 0.78)',
                isPhone: false,
            }
            : null,
        contactLinks.phone
            ? {
                key: 'phone',
                href: contactLinks.phone,
                label: 'Goi dien',
                icon: <PhoneIcon />,
                background: '#16a34a',
                activeShadow: '0 18px 36px rgba(22, 163, 74, 0.42), 0 0 0 4px rgba(187, 247, 208, 0.74)',
                isPhone: true,
            }
            : null,
    ].filter(Boolean);

    if (buttons.length === 0) {
        return null;
    }

    const containerStyle = {
        ...containerBaseStyle,
        right: isCompact ? '14px' : containerBaseStyle.right,
        bottom: isCompact ? '88px' : containerBaseStyle.bottom,
        gap: isCompact ? '10px' : containerBaseStyle.gap,
    };

    return (
        <div style={containerStyle}>
            {buttons.map((button) => (
                <FloatingContactButton key={button.key} button={button} compact={isCompact} />
            ))}
        </div>
    );
};

export default FloatingContactButtons;
