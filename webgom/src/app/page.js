import Image from "next/image";
import Link from "next/link";
import styles from "./page.module.css";
import { getStorefrontData, getWebCategories, getWebProducts } from "@/lib/api";
import { HomeDesktopCatalog, HomeDesktopHero } from "@/components/HomeDesktopHomepage";
import HomeMobileCatalog from "@/components/HomeMobileCatalog";
import { resolveImageObjectUrl, resolveMediaUrl } from "@/lib/media";

const FALLBACK_CATEGORY_BANNER = "/banner-store.png";
const FALLBACK_PRODUCT_IMAGE = "/logo-dai-thanh.png";
const DESKTOP_PRODUCT_BATCH = 8;
const categoryNameSorter = new Intl.Collator("vi");

const FALLBACK_CATEGORIES = [
  { name: "Gốm Men Lam", slug: "gom-men-lam" },
  { name: "Gốm Men Rạn", slug: "gom-men-ran" },
  { name: "Bộ Ấm Trà Đạo", slug: "bo-am-tra-dao" },
  { name: "Tượng Nghệ Thuật", slug: "tuong-phong-thuy" },
  { name: "Gia Dụng Sang Trọng", slug: "gia-dung" },
  { name: "Đèn Trang Trí", slug: "den-trang-tri" },
  { name: "Quà Tặng Doanh Nghiệp", slug: "qua-tang" },
];

function uniqueBySlug(items = []) {
  const seenSlugs = new Set();

  return items.filter((item) => {
    if (!item?.slug || seenSlugs.has(item.slug)) {
      return false;
    }

    seenSlugs.add(item.slug);
    return true;
  });
}

function normalizeCategory(category, index) {
  const slug = String(category?.slug || "").trim();
  const name = String(category?.name || "").trim();

  if (!slug || !name) {
    return null;
  }

  return {
    id: category?.id ?? `${slug}-${index}`,
    name,
    slug,
    href: `/category/${slug}`,
    description: String(category?.description || "").trim(),
    productsCount: Number(category?.products_count || 0),
    bannerSrc: (
      resolveImageObjectUrl(
        category?.banner_image,
        "large",
        resolveMediaUrl(category?.banner_path) || FALLBACK_CATEGORY_BANNER
      ) || FALLBACK_CATEGORY_BANNER
    ),
    order: Number(category?.order ?? index),
  };
}

function normalizeProduct(product) {
  return {
    id: product?.id,
    name: String(product?.name || "").trim() || "Sản phẩm gốm sứ",
    slug: String(product?.slug || product?.id || "").trim(),
    price: product?.price ?? product?.current_price ?? 0,
    currentPrice: product?.current_price ?? product?.price ?? 0,
    primaryImage: product?.primary_image || null,
    imageSrc: resolveMediaUrl(product?.main_image) || FALLBACK_PRODUCT_IMAGE,
    isFeatured: Boolean(product?.is_featured),
    isNew: Boolean(product?.is_new),
  };
}

function getTopLevelCategories(source = []) {
  const categories = Array.isArray(source) ? source : [];
  const topLevelCategories = categories.filter((category) => category?.parent_id == null);
  return topLevelCategories.length ? topLevelCategories : categories;
}

export default async function Home() {
  const [homepageResult, categoriesResult] = await Promise.allSettled([
    getStorefrontData(),
    getWebCategories(),
  ]);

  let homepageData = null;
  let fetchedCategories = [];

  if (homepageResult.status === "fulfilled") {
    homepageData = homepageResult.value;
  } else {
    console.error("Failed to load homepage data:", homepageResult.reason);
  }

  if (categoriesResult.status === "fulfilled") {
    fetchedCategories = Array.isArray(categoriesResult.value) ? categoriesResult.value : [];
  } else {
    console.error("Failed to load homepage categories:", categoriesResult.reason);
  }

  const rawCategories = fetchedCategories.length
    ? fetchedCategories
    : (Array.isArray(homepageData?.categories) ? homepageData.categories : FALLBACK_CATEGORIES);

  const categories = uniqueBySlug(
    getTopLevelCategories(rawCategories)
      .map(normalizeCategory)
      .filter(Boolean)
  ).sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return categoryNameSorter.compare(left.name, right.name);
  });

  const categorySectionResults = await Promise.allSettled(
    categories.map(async (category) => {
      const productsResponse = await getWebProducts({
        category: category.slug,
        page: 1,
        per_page: Math.max(category.productsCount || 0, DESKTOP_PRODUCT_BATCH),
        sort: "popular",
      });

      const products = Array.isArray(productsResponse?.data)
        ? productsResponse.data.map(normalizeProduct)
        : [];

      return {
        ...category,
        products,
        totalProducts: Number(productsResponse?.total || products.length || category.productsCount || 0),
      };
    })
  );

  const desktopCategorySections = categorySectionResults.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    console.error(`Failed to load products for homepage category "${categories[index]?.slug || index}":`, result.reason);

    return {
      ...categories[index],
      products: [],
      totalProducts: categories[index]?.productsCount || 0,
    };
  });

  const visibleDesktopCategorySections = desktopCategorySections.filter((category) => category.totalProducts > 0);
  const visibleCategories = visibleDesktopCategorySections.map(({ products, totalProducts, ...category }) => category);
  const bannerCategories = visibleDesktopCategorySections;

  return (
    <main>
      <div className={`container ${styles.mainLayout}`}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className="material-symbols-outlined">menu</span>
            <h2>DANH MỤC</h2>
          </div>
          <nav className={styles.categoryNav}>
            {visibleCategories.map((category) => (
              <Link key={category.slug} href={category.href}>
                {category.name} <span className="material-symbols-outlined">chevron_right</span>
              </Link>
            ))}
          </nav>
        </aside>

        <HomeDesktopHero bannerCategories={bannerCategories} />

        <section className={`${styles.heroSection} ${styles.mobileOnly}`}>
          <div className={styles.heroBanner}>
            <Image
              src="/hero.png"
              alt="GỐM ĐẠI THÀNH Hero"
              fill
              sizes="100vw"
              style={{ objectFit: "cover" }}
              priority
            />
            <div className={styles.heroOverlay}></div>
            <div className={styles.heroContent}>
              <p className={styles.heroSubtitle}>BỘ SƯU TẬP ĐỘC BẢN</p>
              <h2 className={styles.heroTitle}>TINH HOA<br />ĐẤT VIỆT</h2>
              <Link href="/products" className="btn-primary" style={{ display: "inline-block" }}>
                KHÁM PHÁ NGAY
              </Link>
            </div>
          </div>
        </section>
      </div>

      <section className={`container ${styles.valuesSection}`}>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">auto_fix_high</span>
          <h4>QUY TRÌNH CHẾ TÁC</h4>
          <p>Thủ công tỉ mỉ từng công đoạn</p>
        </div>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">brush</span>
          <h4>NGHỆ NHÂN BÁT TRÀNG</h4>
          <p>Hội tụ những đôi tay tài hoa nhất</p>
        </div>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">factory</span>
          <h4>DÂY CHUYỀN HIỆN ĐẠI</h4>
          <p>Kết hợp truyền thống và công nghệ</p>
        </div>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">public</span>
          <h4>PHÂN PHỐI TOÀN QUỐC</h4>
          <p>Giao hàng an toàn và nhanh chóng</p>
        </div>
      </section>

      <HomeDesktopCatalog categorySections={visibleDesktopCategorySections} />

      <HomeMobileCatalog categorySections={visibleDesktopCategorySections} />
    </main>
  );
}
