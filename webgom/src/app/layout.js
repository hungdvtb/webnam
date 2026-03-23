import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContactButtons from "@/components/FloatingContactButtons";
import { getActiveMenu, getWebCategories, getWebSiteSettings } from "@/lib/api";
import { CartProvider } from "@/context/CartContext";
import TrackingScripts from "@/components/common/TrackingScripts";
import LeadAttributionTracker from "@/components/common/LeadAttributionTracker";

const DEFAULT_TOP_NOTICE = "MIỄN PHÍ VẬN CHUYỂN TOÀN QUỐC CHO ĐƠN HÀNG TỪ 500.000Đ";
const DEFAULT_BRAND_TEXT = "GỐM ĐẠI THÀNH";
const DEFAULT_SEARCH_PLACEHOLDER = "Bạn cần tìm kiếm sản phẩm gì?";
const DEFAULT_FOOTER_DESCRIPTION = "Gìn giữ tinh hoa đất Việt qua từng nét vẽ, mảng men và những tác phẩm gốm sứ thủ công độc bản.";

const DEFAULT_FOOTER_GROUPS = [
  {
    id: "footer-group-products",
    title: "Sản phẩm",
    enabled: true,
    order: 1,
    items: [
      { id: "footer-item-products-1", label: "Gốm men lam", link: "/products", enabled: true, order: 1 },
      { id: "footer-item-products-2", label: "Bộ trà nghệ nhân", link: "/products", enabled: true, order: 2 },
    ],
  },
  {
    id: "footer-group-support",
    title: "Hỗ trợ",
    enabled: true,
    order: 2,
    items: [
      { id: "footer-item-support-1", label: "Chính sách vận chuyển", link: "/policy", enabled: true, order: 1 },
      { id: "footer-item-support-2", label: "Kiến thức gốm", link: "/blog", enabled: true, order: 2 },
    ],
  },
  {
    id: "footer-group-about",
    title: "Về chúng tôi",
    enabled: true,
    order: 3,
    items: [
      { id: "footer-item-about-1", label: "Giới thiệu", link: "/", enabled: true, order: 1 },
      { id: "footer-item-about-2", label: "Hệ thống cửa hàng", link: "/stores", enabled: true, order: 2 },
    ],
  },
];

const parseMenuArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeHeaderMenuItems = (items = []) =>
  items
    .map((item, index) => {
      const title = String(item?.label ?? item?.title ?? "").trim();
      const rawUrl = String(item?.link ?? item?.url ?? "#").trim() || "#";
      const url = rawUrl === "/he-thong-cua-hang" ? "/stores" : rawUrl;
      const order = Number(item?.order ?? item?.sort_order ?? index + 1);

      return {
        id: String(item?.id ?? `header-menu-${index + 1}`),
        title,
        url,
        enabled: item?.enabled === undefined ? true : Boolean(item.enabled),
        order: Number.isFinite(order) ? order : index + 1,
      };
    })
    .filter((item) => item.enabled && item.title)
    .sort((a, b) => a.order - b.order);

const normalizeFooterMenuGroups = (items = []) =>
  items
    .map((group, index) => {
      const fallback = DEFAULT_FOOTER_GROUPS[index] || DEFAULT_FOOTER_GROUPS[0];
      const order = Number(group?.order ?? group?.sort_order ?? index + 1);
      const rawItems = Array.isArray(group?.items) ? group.items : fallback.items;

      return {
        id: String(group?.id ?? `footer-group-${index + 1}`),
        title: String(group?.title ?? group?.label ?? fallback.title ?? "").trim() || fallback.title,
        enabled: group?.enabled === undefined ? true : Boolean(group.enabled),
        order: Number.isFinite(order) ? order : index + 1,
        items: rawItems
          .map((item, itemIndex) => {
            const fallbackItem = fallback.items[itemIndex] || fallback.items[0] || { label: "Liên kết", link: "/" };
            const itemOrder = Number(item?.order ?? item?.sort_order ?? itemIndex + 1);

            return {
              id: String(item?.id ?? `footer-item-${itemIndex + 1}`),
              label: String(item?.label ?? item?.title ?? fallbackItem.label ?? "").trim() || fallbackItem.label,
              link: String(item?.link ?? item?.url ?? fallbackItem.link ?? "/").trim() || "/",
              enabled: item?.enabled === undefined ? true : Boolean(item.enabled),
              order: Number.isFinite(itemOrder) ? itemOrder : itemIndex + 1,
            };
          })
          .filter((item) => item.enabled && item.label)
          .sort((a, b) => a.order - b.order),
      };
    })
    .filter((group) => group.enabled && group.items.length > 0)
    .sort((a, b) => a.order - b.order);

export const metadata = {
  title: "GỐM ĐẠI THÀNH - Tinh Hoa Đất Việt | Gốm Sứ Bát Tràng Cao Cấp",
  description:
    "Chuyên cung cấp các tác phẩm gốm sứ nghệ thuật, bình hút lộc, ấm chén trà đạo cao cấp từ làng gốm Bát Tràng. Di sản văn hóa trong từng tác phẩm.",
  keywords: ["gốm sứ bát tràng", "bình hút lộc", "ấm chén cao cấp", "quà tặng gốm sứ", "gốm nghệ thuật"],
  authors: [{ name: "GỐM ĐẠI THÀNH" }],
  openGraph: {
    title: "GỐM ĐẠI THÀNH - Tinh Hoa Đất Việt",
    description: "Khám phá bộ sưu tập gốm sứ nghệ thuật độc bản.",
    type: "website",
    locale: "vi_VN",
  },
};

export default async function RootLayout({ children }) {
  let menuData = null;
  let settings = null;
  let productCategories = [];

  try {
    const [menuRes, settingsRes] = await Promise.all([
      getActiveMenu(),
      getWebSiteSettings(),
    ]);
    menuData = menuRes;
    settings = settingsRes;
  } catch (error) {
    console.error("Failed to fetch layout data:", error);
  }

  try {
    const categoriesRes = await getWebCategories();
    productCategories = Array.isArray(categoriesRes) ? categoriesRes : [];
  } catch (error) {
    console.error("Failed to fetch header categories:", error);
  }

  const headerMenuItems = normalizeHeaderMenuItems(parseMenuArray(settings?.header_menu_items));
  const menuItems = headerMenuItems.length > 0 ? headerMenuItems : menuData?.root_items || [];
  const topNoticeText = String(settings?.header_notice_text || "").trim() || DEFAULT_TOP_NOTICE;
  const brandText = String(settings?.header_brand_text || settings?.site_name || "").trim() || DEFAULT_BRAND_TEXT;
  const logoUrl = String(settings?.header_logo_url || "").trim();
  const searchPlaceholder =
    String(settings?.header_search_placeholder || "").trim() || DEFAULT_SEARCH_PLACEHOLDER;

  const footerGroups = normalizeFooterMenuGroups(parseMenuArray(settings?.footer_menu_groups));
  const footerConfig = {
    logoUrl: String(settings?.footer_logo_url || "").trim(),
    brandText: String(settings?.footer_brand_text || settings?.site_name || "").trim() || DEFAULT_BRAND_TEXT,
    description: String(settings?.footer_description || "").trim() || DEFAULT_FOOTER_DESCRIPTION,
    hotline: String(settings?.footer_hotline || settings?.contact_phone || "").trim(),
    email: String(settings?.footer_email || settings?.contact_email || "").trim(),
    address: String(settings?.footer_address || "").trim(),
    newsletterPlaceholder: String(settings?.footer_newsletter_placeholder || "").trim() || "Email của bạn",
    copyrightText:
      String(settings?.footer_copyright_text || "").trim() ||
      `© ${new Date().getFullYear()} ${brandText}. Tất cả quyền được bảo lưu.`,
    groups: footerGroups.length > 0 ? footerGroups : normalizeFooterMenuGroups(DEFAULT_FOOTER_GROUPS),
  };

  return (
    <html lang="vi">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        />
        <TrackingScripts settings={settings} />
      </head>
      <body>
        <LeadAttributionTracker />
        <CartProvider>
          <div className="mobile-sticky-header-shell">
            <div className="top-promotion-bar">{topNoticeText}</div>
            <Header
              menuItems={menuItems}
              brandText={brandText}
              logoUrl={logoUrl}
              searchPlaceholder={searchPlaceholder}
              productCategories={productCategories}
            />
          </div>
          <div className="site-content-shell">{children}</div>
          <FloatingContactButtons settings={settings} />
          <Footer config={footerConfig} />
        </CartProvider>
        <style
          dangerouslySetInnerHTML={{
            __html: `
          .top-promotion-bar {
            background-color: #1a2c4e;
            color: white;
            text-align: center;
            padding: 0.5rem 0;
            font-size: 0.875rem;
            font-weight: 500;
            letter-spacing: 0.05em;
          }
        `,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
          .mobile-sticky-header-shell {
            position: relative;
            z-index: 1000;
          }

          .site-content-shell {
            min-height: 0;
          }

          @media (max-width: 768px) {
            .mobile-sticky-header-shell {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              z-index: 1100;
              width: 100%;
            }

            .site-content-shell {
              padding-top: 110px;
            }
          }

          @media (max-width: 640px) {
            .site-content-shell {
              padding-top: 104px;
            }
          }

          @media (max-width: 420px) {
            .site-content-shell {
              padding-top: 98px;
            }
          }
        `,
          }}
        />
      </body>
    </html>
  );
}
