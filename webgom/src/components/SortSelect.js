"use client";

import { useRouter, useSearchParams } from "next/navigation";
import stylesStandard from "../app/products/products.module.css";
import styles2 from "../app/products/layout2.module.css";

export default function SortSelect({ currentSort, variant = "layout1" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const styles = variant === "layout2" ? styles2 : stylesStandard;

  const handleSortChange = (event) => {
    const newSort = event.target.value;
    const params = new URLSearchParams(searchParams.toString());

    params.set("sort", newSort);
    params.delete("page");

    router.push(`/products?${params.toString()}`, { scroll: false });
  };

  return (
    <div className={variant === "layout2" ? styles.sortContainer : styles.sortSelect}>
      {variant !== "layout2" && (
        <span className={styles.sortLabel}>{"S\u1eafp x\u1ebfp:"}</span>
      )}
      <select
        defaultValue={currentSort || "popular"}
        onChange={handleSortChange}
        className={variant === "layout2" ? styles.sortSelect : styles.selectInput}
      >
        <option value="popular">{"Ph\u1ed5 bi\u1ebfn nh\u1ea5t"}</option>
        <option value="newest">{"M\u1edbi nh\u1ea5t"}</option>
        <option value="price_asc">{"Gi\u00e1: Th\u1ea5p \u0111\u1ebfn Cao"}</option>
        <option value="price_desc">{"Gi\u00e1: Cao \u0111\u1ebfn Th\u1ea5p"}</option>
      </select>
    </div>
  );
}
