import Link from "next/link";
import styles from "./page.module.css";
import { getStorefrontData, getWebCategories, getWebProducts } from "@/lib/api";
import { HomeDesktopCatalog, HomeDesktopHero } from "@/components/HomeDesktopHomepage";
import HomeMobileCatalog from "@/components/HomeMobileCatalog";
import HomeMobileHero from "@/components/HomeMobileHero";
import { resolveImageObjectUrl, resolveMediaUrl } from "@/lib/media";
import { getServerPublicHost } from "@/lib/serverPublicHost";

const FALLBACK_CATEGORY_BANNER = "/banner-store.png";
const FALLBACK_PRODUCT_IMAGE = "/logo-dai-thanh.png";
const HOME_CATEGORY_PRODUCT_LIMIT = 6;
const FALLBACK_CATEGORY_TEXT = "Danh m\u1ee5c g\u1ed1m s\u1ee9";
const FALLBACK_PRODUCT_NAME = "S\u1ea3n ph\u1ea9m g\u1ed1m s\u1ee9";
const HOME_CATEGORY_HEADER = "DANH M\u1ee4C";
const categoryNameSorter = new Intl.Collator("vi");
const VIETNAMESE_LOCALE = "vi-VN";

const FALLBACK_CATEGORIES = [
  { name: "G\u1ed1m Men Lam", slug: "gom-men-lam" },
  { name: "G\u1ed1m Men R\u1ea1n", slug: "gom-men-ran" },
  { name: "B\u1ed9 \u1ea4m Tr\u00e0 \u0110\u1ea1o", slug: "bo-am-tra-dao" },
  { name: "T\u01b0\u1ee3ng Ngh\u1ec7 Thu\u1eadt", slug: "tuong-phong-thuy" },
  { name: "Gia D\u1ee5ng Sang Tr\u1ecdng", slug: "gia-dung" },
  { name: "\u0110\u00e8n Trang Tr\u00ed", slug: "den-trang-tri" },
  { name: "Qu\u00e0 T\u1eb7ng Doanh Nghi\u1ec7p", slug: "qua-tang" },
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

function hasLowercaseLetter(value) {
  return /\p{Ll}/u.test(value);
}

function toNaturalCategoryName(value) {
  const trimmedValue = String(value || "").trim();

  if (!trimmedValue || hasLowercaseLetter(trimmedValue)) {
    return trimmedValue;
  }

  return trimmedValue
    .toLocaleLowerCase(VIETNAMESE_LOCALE)
    .replace(/(^|[\s/-])(\p{L})/gu, (match, prefix, character) =>
      `${prefix}${character.toLocaleUpperCase(VIETNAMESE_LOCALE)}`
    );
}

function normalizeCategory(category, index) {
  const slug = String(category?.slug || "").trim();
  const name = toNaturalCategoryName(category?.name);

  if (!slug || !name) {
    return null;
  }

  return {
    id: category?.id ?? `${slug}-${index}`,
    name,
    slug,
    href: `/category/${slug}`,
    description: String(category?.description || "").trim(),
    metaDescription: String(category?.meta_description || "").trim(),
    productsCount: Number(category?.products_count || 0),
    bannerSrc:
      resolveImageObjectUrl(
        category?.banner_image,
        "large",
        resolveMediaUrl(category?.banner_path) || FALLBACK_CATEGORY_BANNER
      ) || FALLBACK_CATEGORY_BANNER,
    order: Number(category?.sort_order ?? category?.public_sort_order ?? category?.order ?? index),
  };
}

function normalizeProduct(product) {
  return {
    id: product?.id,
    name: String(product?.name || "").trim() || FALLBACK_PRODUCT_NAME,
    slug: String(product?.slug || product?.id || "").trim(),
    price: product?.price ?? product?.current_price ?? 0,
    currentPrice: product?.current_price ?? product?.price ?? 0,
    primaryImage: product?.primary_image || null,
    imageSrc: resolveMediaUrl(product?.main_image) || FALLBACK_PRODUCT_IMAGE,
    isFeatured: Boolean(product?.is_featured),
    type: String(product?.type || "").trim().toLowerCase(),
    itemType: String(product?.item_type || "").trim().toLowerCase() || "product",
    bundleOptionUid: String(product?.bundle_option_uid || "").trim(),
    bundleOptionKey: String(product?.bundle_option_key || "").trim(),
    bundleOptionTitle: String(product?.bundle_option_title || "").trim(),
  };
}

function getTopLevelCategories(source = []) {
  const categories = Array.isArray(source) ? source : [];
  const topLevelCategories = categories.filter((category) => category?.parent_id == null);
  return topLevelCategories.length ? topLevelCategories : categories;
}

function resolveCategoryProductsCount(category, totalProducts) {
  const explicitCount = Number(totalProducts);
  if (Number.isFinite(explicitCount) && explicitCount > 0) {
    return explicitCount;
  }

  const fallbackCount = Number(category?.productsCount || 0);
  return Number.isFinite(fallbackCount) ? fallbackCount : 0;
}

function getCategoryEyebrow(category, totalProducts) {
  const productsCount = resolveCategoryProductsCount(category, totalProducts);
  if (productsCount > 0) {
    return `${productsCount} s\u1ea3n ph\u1ea9m`;
  }

  const description = String(category?.metaDescription || category?.description || "").trim();
  return description || FALLBACK_CATEGORY_TEXT;
}

function getCategoryHeroDescription(category, totalProducts) {
  const description = String(category?.metaDescription || category?.description || "").trim();
  if (description) {
    return description;
  }

  const productsCount = resolveCategoryProductsCount(category, totalProducts);
  if (productsCount > 0) {
    return `Kh\u00e1m ph\u00e1 ${productsCount} s\u1ea3n ph\u1ea9m trong danh m\u1ee5c ${category.name}.`;
  }

  return FALLBACK_CATEGORY_TEXT;
}

export default async function Home() {
  const publicHost = await getServerPublicHost();
  const [homepageResult, categoriesResult] = await Promise.allSettled([
    getStorefrontData(),
    getWebCategories({ publicHost }),
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
    : Array.isArray(homepageData?.categories)
      ? homepageData.categories
      : FALLBACK_CATEGORIES;

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
        per_page: HOME_CATEGORY_PRODUCT_LIMIT,
        sort: "popular",
        public_host: publicHost,
      });

      const products = Array.isArray(productsResponse?.data)
        ? productsResponse.data.map(normalizeProduct)
        : [];
      const totalProducts = Number(productsResponse?.total || products.length || category.productsCount || 0);

      return {
        ...category,
        products,
        totalProducts,
        eyebrow: getCategoryEyebrow(category, totalProducts),
        heroDescription: getCategoryHeroDescription(category, totalProducts),
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
      eyebrow: getCategoryEyebrow(categories[index], categories[index]?.productsCount || 0),
      heroDescription: getCategoryHeroDescription(categories[index], categories[index]?.productsCount || 0),
    };
  });

  const visibleDesktopCategorySections = desktopCategorySections.filter((category) => category.totalProducts > 0);
  const sidebarCategories = categories;
  const bannerCategories = visibleDesktopCategorySections;

  return (
    <main>
      <div className={`container ${styles.mainLayout}`}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className="material-symbols-outlined">menu</span>
            <h2>{HOME_CATEGORY_HEADER}</h2>
          </div>
          <nav className={styles.categoryNav}>
            {sidebarCategories.map((category) => (
              <Link key={category.slug} href={category.href}>
                <span className={styles.categoryNavLabel}>{category.name}</span>
                <span className={`material-symbols-outlined ${styles.categoryNavIcon}`}>chevron_right</span>
              </Link>
            ))}
          </nav>
        </aside>

        <HomeDesktopHero bannerCategories={bannerCategories} />

        <section className={`${styles.heroSection} ${styles.mobileOnly} ${styles.mobileHeroSection}`}>
          <HomeMobileHero
            key={bannerCategories.map((category) => category.slug).join("|")}
            bannerCategories={bannerCategories}
          />
        </section>
      </div>

      <section className={`container ${styles.valuesSection}`}>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">auto_fix_high</span>
          <h4>{"Ch\u1ebf t\u00e1c"} <br />{"th\u1ee7 c\u00f4ng"}</h4>
        </div>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">brush</span>
          <h4>{"Ngh\u1ec7 nh\u00e2n"} <wbr />{"B\u00e1t Tr\u00e0ng"}</h4>
        </div>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">factory</span>
          <h4>{"D\u00e2y chuy\u1ec1n"} <wbr />{"hi\u1ec7n \u0111\u1ea1i"}</h4>
        </div>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">public</span>
          <h4>{"Ph\u00e2n ph\u1ed1i"} <wbr />{"to\u00e0n qu\u1ed1c"}</h4>
        </div>
      </section>

      <HomeDesktopCatalog categorySections={visibleDesktopCategorySections} />

      <HomeMobileCatalog categorySections={visibleDesktopCategorySections} />
    </main>
  );
}
