import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { getActiveMenu, getWebSiteSettings } from "@/lib/api";
import { CartProvider } from "@/context/CartContext";
import TrackingScripts from "@/components/common/TrackingScripts";

const DEFAULT_TOP_NOTICE = "MIỄN PHÍ VẬN CHUYỂN TOÀN QUỐC CHO ĐƠN HÀNG TỪ 500.000Đ";
const DEFAULT_BRAND_TEXT = "GỐM ĐẠI THÀNH";
const DEFAULT_SEARCH_PLACEHOLDER = "Bạn cần tìm kiếm sản phẩm gì?";

const parseHeaderMenuItems = (value) => {
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
      const url = String(item?.link ?? item?.url ?? "#").trim() || "#";
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

  const headerMenuItems = normalizeHeaderMenuItems(parseHeaderMenuItems(settings?.header_menu_items));
  const menuItems = headerMenuItems.length > 0 ? headerMenuItems : menuData?.root_items || [];
  const topNoticeText = String(settings?.header_notice_text || "").trim() || DEFAULT_TOP_NOTICE;
  const brandText = String(settings?.header_brand_text || settings?.site_name || "").trim() || DEFAULT_BRAND_TEXT;
  const searchPlaceholder =
    String(settings?.header_search_placeholder || "").trim() || DEFAULT_SEARCH_PLACEHOLDER;

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
        <div className="top-promotion-bar">{topNoticeText}</div>
        <CartProvider>
          <Header
            menuItems={menuItems}
            brandText={brandText}
            searchPlaceholder={searchPlaceholder}
          />
          {children}
          <Footer />
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
      </body>
    </html>
  );
}
