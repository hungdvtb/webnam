'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { trackPageView, trackProductView } from '@/lib/analytics';

export default function WebAnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    trackPageView();
  }, [pathname]);

  return null;
}

export function ProductAnalyticsTracker({ product }) {
  const productId = product?.id;
  const productSlug = product?.slug;

  useEffect(() => {
    trackProductView(product);
  }, [productId, productSlug, product]);

  return null;
}
