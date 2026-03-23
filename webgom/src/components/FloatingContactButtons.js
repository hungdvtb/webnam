"use client";

import { useEffect, useRef, useState } from "react";
import floatingContactConfig from "@/lib/floatingContactConfig";
import styles from "./FloatingContactButtons.module.css";

const normalizePhoneHref = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.toLowerCase().startsWith("tel:")) {
    return trimmed;
  }

  const sanitized = trimmed.replace(/[^\d+]/g, "");
  return sanitized ? `tel:${sanitized}` : "";
};

const normalizeExternalUrl = (value, provider) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  if (/^(https?:|mailto:|tel:|zalo:)/i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  if (provider === "messenger") {
    const normalized = trimmed
      .replace(/^https?:\/\/(www\.)?facebook\.com\//i, "")
      .replace(/^https?:\/\/m\.me\//i, "")
      .replace(/^https?:\/\/(www\.)?messenger\.com\/t\//i, "")
      .replace(/^\/+/, "")
      .split(/[/?#]/)[0]
      .trim();

    if (normalized) {
      return `https://m.me/${normalized}`;
    }
  }

  if (provider === "zalo") {
    const zaloId = trimmed.replace(/[^\d]/g, "");
    if (zaloId) {
      return `https://zalo.me/${zaloId}`;
    }
  }

  return `https://${trimmed.replace(/^\/+/, "")}`;
};

const getFirstAvailablePhone = (settings) => {
  if (!settings || typeof settings !== "object") {
    return floatingContactConfig.phone || "";
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
    ""
  );
};

const buildContactLinks = (settings) => {
  const phoneSource = getFirstAvailablePhone(settings);
  const phone = normalizePhoneHref(phoneSource);
  const zaloSource = settings?.zalo_link || floatingContactConfig.zalo || phoneSource;
  const messengerSource =
    settings?.messenger_link ||
    settings?.facebook_link ||
    floatingContactConfig.messenger;

  return [
    {
      key: "zalo",
      href: normalizeExternalUrl(zaloSource, "zalo"),
      label: "Chat Zalo",
      variant: styles.zalo,
      icon: (
        <svg viewBox="0 0 24 24" className={styles.icon} fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.25" fill="currentColor" fillOpacity="0.12" />
          <path d="M7 8H17L7.8 16H17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      key: "messenger",
      href: normalizeExternalUrl(messengerSource, "messenger"),
      label: "Chat Messenger",
      variant: styles.messenger,
      icon: (
        <svg viewBox="0 0 24 24" className={styles.icon} fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.907 1.434 5.503 3.683 7.197V22l3.38-1.856c.903.25 1.86.383 2.937.383 5.523 0 10-4.145 10-9.243C22 6.145 17.523 2 12 2zm1.039 12.458l-2.545-2.715L5.5 14.458l5.474-5.81 2.608 2.715L18.5 8.148l-5.461 6.31z" />
        </svg>
      ),
    },
    {
      key: "phone",
      href: phone,
      label: "Goi dien",
      variant: styles.phone,
      isPhone: true,
      icon: (
        <svg viewBox="0 0 24 24" className={styles.icon} fill="none" aria-hidden="true">
          <path
            d="M6.599 4h2.364a1.5 1.5 0 0 1 1.478 1.243l.553 3.064a1.5 1.5 0 0 1-.811 1.602l-1.649.785a13.873 13.873 0 0 0 4.772 4.772l.785-1.649a1.5 1.5 0 0 1 1.602-.811l3.064.553A1.5 1.5 0 0 1 20 15.037V17.4a2 2 0 0 1-2.175 1.994C10.19 18.907 5.093 13.81 4.606 6.175A2 2 0 0 1 6.599 4Z"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  ].filter((button) => Boolean(button.href));
};

function ContactMenuGlyph({ isOpen }) {
  if (isOpen) {
    return (
      <svg viewBox="0 0 24 24" className={styles.icon} fill="none" aria-hidden="true">
        <path
          d="M7 7L17 17M17 7L7 17"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={styles.icon} fill="none" aria-hidden="true">
      <path
        d="M7.25 5.5h9.5A3.25 3.25 0 0 1 20 8.75v5.1a3.25 3.25 0 0 1-3.25 3.25h-3.6L9.1 20v-2.9H7.25A3.25 3.25 0 0 1 4 13.85v-5.1A3.25 3.25 0 0 1 7.25 5.5Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="11.3" r="1" fill="currentColor" />
      <circle cx="12" cy="11.3" r="1" fill="currentColor" />
      <circle cx="15" cy="11.3" r="1" fill="currentColor" />
    </svg>
  );
}

export default function FloatingContactButtons({ settings }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const containerRef = useRef(null);
  const buttons = buildContactLinks(settings);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setIsMobileMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMobileMenuOpen]);

  if (buttons.length === 0) {
    return null;
  }

  return (
    <>
      <div className={styles.desktopFloatingContacts}>
        {buttons.map((button) => (
          <a
            key={button.key}
            href={button.href}
            aria-label={button.label}
            title={button.label}
            className={`${styles.button} ${button.variant}`}
            target={button.isPhone ? undefined : "_blank"}
            rel={button.isPhone ? undefined : "noopener noreferrer"}
          >
            {button.icon}
          </a>
        ))}
      </div>

      <div className={styles.mobileFloatingContacts} ref={containerRef}>
        <div className={`${styles.mobileMenu} ${isMobileMenuOpen ? styles.mobileMenuOpen : ""}`}>
          {buttons.map((button) => (
            <a
              key={`mobile-${button.key}`}
              href={button.href}
              aria-label={button.label}
              title={button.label}
              className={`${styles.button} ${button.variant} ${styles.mobileMenuButton}`}
              target={button.isPhone ? undefined : "_blank"}
              rel={button.isPhone ? undefined : "noopener noreferrer"}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {button.icon}
            </a>
          ))}
        </div>

        <button
          type="button"
          className={`${styles.button} ${styles.mobileToggle} ${isMobileMenuOpen ? styles.mobileToggleOpen : ""}`}
          aria-label={isMobileMenuOpen ? "Dong lien he" : "Mo lien he"}
          aria-expanded={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
        >
          <ContactMenuGlyph isOpen={isMobileMenuOpen} />
        </button>
      </div>
    </>
  );
}
