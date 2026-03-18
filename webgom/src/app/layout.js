import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { getActiveMenu, getWebSiteSettings } from "@/lib/api";
import { CartProvider } from "@/context/CartContext";
import TrackingScripts from "@/components/common/TrackingScripts";

export const metadata = {
  title: "GÔM ĐẠI THÀNH - Tinh Hoa Đất Việt | Gốm Sứ Bát Tràng Cao Cấp",
  description: "Chuyên cung cấp các tác phẩm gốm sứ nghệ thuật, bình hút lộc, ấm chén trà đạo cao cấp từ làng gốm Bát Tràng. Di sản văn hóa trong từng tác phẩm.",
  keywords: ["gốm sứ bát tràng", "bình hút lộc", "ấm chén cao cấp", "quà tặng gốm sứ", "gốm nghệ thuật"],
  authors: [{ name: "GÔM ĐẠI THÀNH" }],
  openGraph: {
    title: "GÔM ĐẠI THÀNH - Tinh Hoa Đất Việt",
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
      getWebSiteSettings()
    ]);
    menuData = menuRes;
    settings = settingsRes;
  } catch (error) {
    console.error("Failed to fetch layout data:", error);
  }

  const menuItems = menuData?.root_items || [];

  return (
    <html lang="vi">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" />
        <TrackingScripts settings={settings} />
      </head>
      <body>
        <div className="top-promotion-bar">
          MIỄN PHÍ VẬN CHUYỂN TOÀN QUỐC CHO ĐƠN HÀNG TỪ 500.000Đ
        </div>
        <CartProvider>
          <Header menuItems={menuItems} />
          {children}
          <Footer />
        </CartProvider>
        <style dangerouslySetInnerHTML={{ __html: `
          .top-promotion-bar {
            background-color: #1a2c4e;
            color: white;
            text-align: center;
            padding: 0.5rem 0;
            font-size: 0.875rem;
            font-weight: 500;
            letter-spacing: 0.05em;
          }
        `}} />
      </body>
    </html>
  );
}
