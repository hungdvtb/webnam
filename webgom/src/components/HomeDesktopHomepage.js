"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useEffectEvent, useState } from "react";
import styles from "@/app/page.module.css";
import { resolveImageObjectUrl } from "@/lib/media";
import { buildProductCardKey, buildProductDetailHref } from "@/lib/productLinks";

const BANNER_ROTATE_MS = 10000;
const BANNER_SLOT_COUNT = 3;
const FALLBACK_CATEGORY_TEXT = "Danh m\u1ee5c g\u1ed1m s\u1ee9";
const FALLBACK_PRODUCT_ALT = "S\u1ea3n ph\u1ea9m g\u1ed1m s\u1ee9";
const FALLBACK_PRODUCT_IMAGE = "/logo-dai-thanh.png";

function shuffleItems(items) {
  const nextItems = [...items];

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [nextItems[index], nextItems[randomIndex]] = [nextItems[randomIndex], nextItems[index]];
  }

  return nextItems;
}

function getDefaultBannerSlugs(categories) {
  return categories.slice(0, BANNER_SLOT_COUNT).map((category) => category.slug);
}

function pickBannerSlugs(categories, currentSlugs = []) {
  if (categories.length <= BANNER_SLOT_COUNT) {
    return getDefaultBannerSlugs(categories);
  }

  const currentSlugSet = new Set(currentSlugs);
  const unusedCategories = categories.filter((category) => !currentSlugSet.has(category.slug));
  const source = unusedCategories.length >= BANNER_SLOT_COUNT ? unusedCategories : categories;

  return shuffleItems(source)
    .slice(0, BANNER_SLOT_COUNT)
    .map((category) => category.slug);
}

function getActiveBanners(categories, slugs) {
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const selected = [];
  const usedSlugs = new Set();

  slugs.forEach((slug) => {
    const category = bySlug.get(slug);
    if (!category || usedSlugs.has(slug)) {
      return;
    }

    selected.push(category);
    usedSlugs.add(slug);
  });

  categories.forEach((category) => {
    if (selected.length >= BANNER_SLOT_COUNT || usedSlugs.has(category.slug)) {
      return;
    }

    selected.push(category);
    usedSlugs.add(category.slug);
  });

  return selected.slice(0, BANNER_SLOT_COUNT);
}

function formatPrice(value) {
  const numericValue = Number.parseFloat(value || 0);
  const resolvedValue = Number.isFinite(numericValue) ? numericValue : 0;

  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(resolvedValue);
}

function getProductImageSrc(product) {
  return (
    resolveImageObjectUrl(product?.primaryImage, "medium", product?.imageSrc || FALLBACK_PRODUCT_IMAGE)
    || product?.imageSrc
    || FALLBACK_PRODUCT_IMAGE
  );
}

export function HomeDesktopHero({ bannerCategories = [] }) {
  const [activeBannerSlugs, setActiveBannerSlugs] = useState(() => getDefaultBannerSlugs(bannerCategories));

  useEffect(() => {
    setActiveBannerSlugs(getDefaultBannerSlugs(bannerCategories));
  }, [bannerCategories]);

  const rotateBanners = useEffectEvent(() => {
    setActiveBannerSlugs((currentSlugs) => pickBannerSlugs(bannerCategories, currentSlugs));
  });

  useEffect(() => {
    if (bannerCategories.length <= 1) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      rotateBanners();
    }, BANNER_ROTATE_MS);

    return () => window.clearInterval(intervalId);
  }, [bannerCategories.length]);

  const activeBanners = getActiveBanners(bannerCategories, activeBannerSlugs);
  const heroBanner = activeBanners[0];
  const sideBanners = activeBanners.slice(1, BANNER_SLOT_COUNT);

  if (!heroBanner) {
    return null;
  }

  return (
    <>
      <section className={`${styles.heroSection} ${styles.desktopOnly}`}>
        <Link href={heroBanner.href} className={styles.heroBannerLink}>
          <div className={styles.heroBanner}>
            <Image
              src={heroBanner.bannerSrc}
              alt={heroBanner.name || FALLBACK_CATEGORY_TEXT}
              fill
              sizes="(min-width: 1201px) calc(100vw - 660px), 100vw"
              style={{ objectFit: "cover" }}
              priority
              unoptimized
            />
            <div className={styles.heroOverlay}></div>
            <div className={styles.heroContent}>
              <p className={styles.heroSubtitle}>{heroBanner.eyebrow}</p>
              <h2 className={`${styles.heroTitle} ${styles.dynamicHeroTitle}`}>{heroBanner.name}</h2>
              <p className={styles.heroDescription}>{heroBanner.heroDescription}</p>
              <span className={`btn-primary ${styles.heroCta}`}>KH\u00c1M PH\u00c1 NGAY</span>
            </div>
          </div>
        </Link>
      </section>

      <div className={`${styles.heroSideBanners} ${styles.desktopOnly}`}>
        {sideBanners.map((banner) => (
          <Link
            key={banner.slug}
            href={banner.href}
            className={styles.sideBanner}
            style={{ backgroundImage: `url("${banner.bannerSrc}")` }}
          >
            <div className={styles.bannerText}>
              <p>{banner.eyebrow}</p>
              <h3>{banner.name}</h3>
              <span className={styles.sideBannerCta}>Kh\u00e1m ph\u00e1 ngay</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

export function HomeDesktopCatalog({ categorySections = [] }) {
  if (!categorySections.length) {
    return null;
  }

  return (
    <section className={`container ${styles.productsSection} ${styles.desktopOnly}`}>
      <div className={styles.catalogGroups}>
        {categorySections.map((section) => {
          return (
            <article key={section.slug} className={styles.categoryGroup}>
              <div className={styles.sectionHeader}>
                <div className={styles.headerLeft}>
                  <div>
                    <h2 className={styles.sectionTitle}>{section.name}</h2>
                    <p className={styles.categoryMeta}>{section.eyebrow}</p>
                  </div>
                </div>
                <Link href={section.href} className={styles.viewAll}>
                  Xem t\u1ea5t c\u1ea3 <span className="material-symbols-outlined">arrow_forward</span>
                </Link>
              </div>

              {section.products.length > 0 ? (
                <div className={styles.productsGrid}>
                  {section.products.map((product) => {
                    const productHref = buildProductDetailHref(product);
                    const productCardKey = buildProductCardKey(product);

                    return (
                      <Link
                        href={productHref}
                        key={`${section.slug}-${productCardKey}`}
                        className={styles.productCard}
                      >
                        <div className={styles.productImage}>
                          <Image
                            src={getProductImageSrc(product)}
                            alt={product.name || FALLBACK_PRODUCT_ALT}
                            fill
                            sizes="(min-width: 1201px) 25vw, 100vw"
                            style={{ objectFit: "cover" }}
                            unoptimized
                          />
                          {product.isFeatured && (
                            <span className={`${styles.badge} ${styles.badgeHot}`}>HOT</span>
                          )}
                          {!product.isFeatured && product.isNew && (
                            <span className={`${styles.badge} ${styles.badgeSale}`}>M\u1edbi</span>
                          )}
                        </div>

                        <div className={styles.productInfo}>
                          <h4 className={styles.productName}>{product.name}</h4>
                          <div className={styles.productPrice}>
                            <span className={styles.currentPrice}>
                              {formatPrice(product.currentPrice ?? product.price)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.emptyCategoryState}>
                  Danh m\u1ee5c n\u00e0y hi\u1ec7n ch\u01b0a c\u00f3 s\u1ea3n ph\u1ea9m \u0111\u1ec3 hi\u1ec3n th\u1ecb.
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
