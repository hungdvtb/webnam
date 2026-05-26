"use client";

import { useEffect, useRef, useState } from "react";
import floatingContactConfig from "@/lib/floatingContactConfig";
import styles from "./FloatingContactButtons.module.css";

const STORES_PATH = "/stores";

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

const getPhoneDisplayText = (value) =>
  String(value || "")
    .trim()
    .replace(/^tel:/i, "")
    .trim();

const buildContactItems = (settings) => {
  const phoneSource = getFirstAvailablePhone(settings);
  const phone = normalizePhoneHref(phoneSource);
  const zaloSource =
    settings?.zalo_link ||
    settings?.zalo_url ||
    settings?.zaloUrl ||
    floatingContactConfig.zalo ||
    phoneSource;
  const messengerSource =
    settings?.messenger_link ||
    settings?.messenger_url ||
    settings?.messengerUrl ||
    settings?.facebook_link ||
    floatingContactConfig.messenger;
  const phoneDisplayText = getPhoneDisplayText(phoneSource);

  return [
    {
      key: "phone",
      href: phone,
      title: "Hotline",
      description: phoneDisplayText ? `Gọi ${phoneDisplayText}` : "Gọi tư vấn nhanh",
      iconName: "call",
      iconClassName: styles.hotlineIcon,
      isPhone: true,
    },
    {
      key: "zalo",
      href: normalizeExternalUrl(zaloSource, "zalo"),
      title: "Zalo",
      description: "Chat qua Zalo",
      iconText: "Z",
      iconClassName: styles.zaloIcon,
      isExternal: true,
    },
    {
      key: "messenger",
      href: normalizeExternalUrl(messengerSource, "messenger"),
      title: "Messenger",
      description: "Nhắn tin Facebook Messenger",
      iconName: "forum",
      iconClassName: styles.messengerIcon,
      isExternal: true,
    },
    {
      key: "stores",
      href: STORES_PATH,
      title: "Hệ thống cửa hàng",
      description: "Xem địa chỉ cửa hàng",
      iconName: "storefront",
      iconClassName: styles.storesIcon,
    },
  ].filter((button) => Boolean(button.href));
};

function ContactGlyph() {
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

function CloseGlyph() {
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

function ContactItemIcon({ item }) {
  const className = `${styles.contactItemIcon} ${item.iconClassName || ""}`;

  if (item.iconText) {
    return (
      <span className={className} aria-hidden="true">
        <span className={styles.zaloMark}>{item.iconText}</span>
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      <span className="material-symbols-outlined">{item.iconName}</span>
    </span>
  );
}

const MOBILE_OVERLAY_SELECTORS = [
  '[aria-modal="true"]',
  '[role="dialog"]',
  ".mobile-products-sheet-open",
  ".mobile-product-info-sheet-open",
  ".search-history-panel",
  ".stores-lightbox",
  '[class*="bundleActionOverlay"]',
  '[class*="modalOverlay"]',
  '[class*="modalOverlaySheet"]',
  '[class*="CategoryVariantQuickAdd_backdrop"]',
  '[class*="sortDialogContent"]',
].join(",");

const isHiddenByAncestor = (element) => {
  let current = element;

  while (current && current !== document.body) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") {
      return true;
    }

    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") {
      return true;
    }

    current = current.parentElement;
  }

  return false;
};

const isVisibleOverlay = (element) => {
  if (!element || isHiddenByAncestor(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
};

const hasOpenMobileOverlay = (ignoredRoot = null) => {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }

  return Array.from(document.querySelectorAll(MOBILE_OVERLAY_SELECTORS)).some((element) => {
    if (ignoredRoot?.contains(element)) {
      return false;
    }

    return isVisibleOverlay(element);
  });
};

export default function FloatingContactButtons({ settings }) {
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [isMobileOverlayOpen, setIsMobileOverlayOpen] = useState(false);
  const containerRef = useRef(null);
  const contactItems = buildContactItems(settings);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    let animationFrame = 0;

    const syncMobileOverlayState = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      animationFrame = window.requestAnimationFrame(() => {
        const nextIsOpen = mediaQuery.matches && hasOpenMobileOverlay(containerRef.current);

        setIsMobileOverlayOpen((currentValue) => (
          currentValue === nextIsOpen ? currentValue : nextIsOpen
        ));

        if (nextIsOpen) {
          setIsContactOpen(false);
        }
      });
    };

    const observer = new MutationObserver(syncMobileOverlayState);

    syncMobileOverlayState();
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "aria-modal", "class", "hidden", "role", "style"],
    });

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncMobileOverlayState);
    } else {
      mediaQuery.addListener(syncMobileOverlayState);
    }

    window.addEventListener("resize", syncMobileOverlayState);

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      observer.disconnect();
      window.removeEventListener("resize", syncMobileOverlayState);

      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", syncMobileOverlayState);
      } else {
        mediaQuery.removeListener(syncMobileOverlayState);
      }
    };
  }, []);

  useEffect(() => {
    if (!isContactOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setIsContactOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsContactOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isContactOpen]);

  if (contactItems.length === 0) {
    return null;
  }

  return (
    <div
      className={`${styles.floatingContacts} ${
        isMobileOverlayOpen ? styles.floatingContactsHidden : ""
      } ${isContactOpen ? styles.floatingContactsOpen : ""}`}
      ref={containerRef}
      aria-hidden={isMobileOverlayOpen}
    >
      {isContactOpen ? (
        <div
          id="floating-contact-popup"
          className={styles.contactPopup}
          role="dialog"
          aria-modal="false"
          aria-labelledby="floating-contact-title"
        >
          <div className={styles.popupHeader}>
            <h2 id="floating-contact-title">Liên hệ với chúng tôi</h2>
            <button
              type="button"
              className={styles.popupClose}
              aria-label="Đóng liên hệ"
              onClick={() => setIsContactOpen(false)}
            >
              <CloseGlyph />
            </button>
          </div>

          <div className={styles.contactList}>
            {contactItems.map((item) => (
              <a
                key={item.key}
                href={item.href}
                className={styles.contactItem}
                target={item.isExternal ? "_blank" : undefined}
                rel={item.isExternal ? "noopener noreferrer" : undefined}
                onClick={() => setIsContactOpen(false)}
              >
                <ContactItemIcon item={item} />
                <span className={styles.contactItemText}>
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className={`${styles.contactTrigger} ${isContactOpen ? styles.contactTriggerOpen : ""}`}
        aria-label={isContactOpen ? "Đóng liên hệ" : "Mở liên hệ"}
        aria-expanded={isContactOpen}
        aria-controls={isContactOpen ? "floating-contact-popup" : undefined}
        onClick={() => setIsContactOpen((prev) => !prev)}
      >
        {isContactOpen ? (
          <CloseGlyph />
        ) : (
          <ContactGlyph />
        )}
      </button>
    </div>
  );
}
