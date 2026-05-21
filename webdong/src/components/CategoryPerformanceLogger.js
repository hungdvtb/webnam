"use client";

import { useEffect } from "react";
import { logCategoryTiming, markCategoryRouteReady } from "@/lib/productPerformance";

const summarizeTiming = (timing = null) => {
  if (!timing || typeof timing !== "object") {
    return null;
  }

  return {
    endpoint: timing.endpoint || "",
    durationMs: timing.durationMs ?? null,
    serverTiming: timing.serverTiming || "",
    webgomTiming: timing.webgomTiming || "",
  };
};

export default function CategoryPerformanceLogger({
  categorySlug = "",
  productsCount = 0,
  filtersCount = 0,
  productsTiming = null,
  categoriesTiming = null,
  categoryTiming = null,
}) {
  useEffect(() => {
    markCategoryRouteReady({
      categorySlug,
      productsCount,
      filtersCount,
    });

    logCategoryTiming("api-category", {
      categorySlug,
      list: summarizeTiming(categoriesTiming),
      detail: summarizeTiming(categoryTiming),
    });

    logCategoryTiming("api-products", {
      categorySlug,
      productsCount,
      timing: summarizeTiming(productsTiming),
    });

    logCategoryTiming("api-filters", {
      categorySlug,
      filtersCount,
      source: "products.available_filters",
    });
  }, [categorySlug, productsCount, filtersCount, productsTiming, categoriesTiming, categoryTiming]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const images = Array.from(document.querySelectorAll('[data-product-card="true"] img'));
    if (images.length === 0) {
      logCategoryTiming("render-images", {
        categorySlug,
        imageCount: 0,
        loadedCount: 0,
      });
      return undefined;
    }

    let firstLogged = false;
    const loadedImages = new Set(images.filter((image) => image.complete));

    const logProgress = (image, state = "load") => {
      loadedImages.add(image);

      if (!firstLogged) {
        firstLogged = true;
        logCategoryTiming("render-image-first", {
          categorySlug,
          imageCount: images.length,
          loadedCount: loadedImages.size,
          state,
        });
      }

      if (loadedImages.size >= images.length) {
        logCategoryTiming("render-images", {
          categorySlug,
          imageCount: images.length,
          loadedCount: loadedImages.size,
        });
      }
    };

    if (loadedImages.size > 0) {
      logProgress(images.find((image) => image.complete) || images[0], "complete");
    }

    images.forEach((image) => {
      image.addEventListener("load", () => logProgress(image, "load"), { once: true });
      image.addEventListener("error", () => logProgress(image, "error"), { once: true });
    });

    return undefined;
  }, [categorySlug, productsCount]);

  return null;
}
