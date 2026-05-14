import Link from "next/link";
import InfiniteProductList from "@/components/InfiniteProductList";
import styles from "@/app/page.module.css";

const MOBILE_PRODUCTS_PER_SECTION = 6;

export default function HomeMobileCatalog({ categorySections = [] }) {
  if (!categorySections.length) {
    return null;
  }

  return (
    <section className={`${styles.mobileOnly} ${styles.homeMobileCatalogShell}`}>
      <div className={`container ${styles.homeMobileCatalogContainer}`}>
        <div className={styles.homeMobileCatalogStack}>
          {categorySections.map((section) => (
            <article key={section.slug} className={styles.homeMobileCatalogGroup}>
              <div className={styles.homeMobileCatalogHeader}>
                <div className={styles.homeMobileCatalogHeading}>
                  <div className={styles.homeMobileCatalogTitleRow}>
                    <h2 className={styles.homeMobileCatalogTitle}>{section.name}</h2>
                    <Link href={section.href} className={styles.homeMobileCatalogLink}>
                      Xem tất cả <span className="material-symbols-outlined">arrow_forward</span>
                    </Link>
                  </div>
                  <p className={styles.homeMobileCatalogMeta}>{section.eyebrow}</p>
                </div>
              </div>

              <InfiniteProductList
                initialData={{
                  data: section.products.slice(0, MOBILE_PRODUCTS_PER_SECTION).map((product) => ({
                    id: product.id,
                    name: product.name,
                    slug: product.slug,
                    price: product.currentPrice ?? product.price,
                    type: product.type,
                    primary_image: product.primaryImage,
                    itemType: product.itemType,
                    bundleOptionUid: product.bundleOptionUid,
                    bundleOptionKey: product.bundleOptionKey,
                    bundleOptionTitle: product.bundleOptionTitle,
                  })),
                }}
              />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
